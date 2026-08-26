import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import type { RcloneClient, RcloneCoreStats, RcloneJobStatus } from './client.js';
import { revealRcloneObscured } from './obscure.js';
import { getRcloneRcCredentials } from './rcCredentials.js';
import type { RcloneDirEntry, RcloneProvider, RcloneProviderOption, RcloneRemote, RcloneRemoteSetupResult } from './types.js';

const execFileAsync = promisify(execFile);

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

// The subset of rclone's own `config/providers` response shape this client actually reads -
// confirmed live against rclone v1.75.0 (see backend/src/rclone/realClient.ts's doc comment on
// listProviders for how this was verified). Real responses have several more fields per option
// (Exclusive, Sensitive, Examples, ...) nothing here uses.
interface RcProviderOptionJson {
  Name: string;
  Help: string;
  Default: unknown;
  Required: boolean;
  IsPassword: boolean;
  Advanced: boolean;
  // rclone's own bitmask (OptionHideCommandLine = 1, OptionHideConfigurator = 2) - confirmed live
  // that every field with bit 2 set is either genuinely deprecated ("Deprecated: No longer
  // needed.", drive's alternate_export) or meant only for CLI flags, not an interactive config
  // wizard (drive's team_drive/service_account_credentials) - the same category this app's
  // dynamic Add-remote form belongs in. Bit 1 alone (CLI-only) is left visible here on purpose.
  Hide: number;
  Type: string;
}
interface RcProviderJson {
  Name: string;
  Description: string;
  Options: RcProviderOptionJson[];
}

async function rcCall<T>(rcPath: string, body: Record<string, unknown> = {}): Promise<T> {
  const creds = await getRcloneRcCredentials();
  if (!creds) {
    throw new Error("Remote Backup's rclone-rcd credentials aren't available - re-run tools/install-webui.sh's ensure_rclone step.");
  }
  const auth = Buffer.from(`${creds.user}:${creds.pass}`).toString('base64');
  let res: Response;
  try {
    res = await fetch(`${config.rcloneRcUrl}/${rcPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${auth}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.rcloneRcTimeoutMs),
    });
  } catch (err) {
    throw new Error(`Couldn't reach rclone-rcd at ${config.rcloneRcUrl} (${(err as Error).message}) - is the rclone-rcd service running?`);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
  if (!res.ok) {
    throw new Error(json?.error || `rclone rcd ${rcPath} failed: HTTP ${res.status}`);
  }
  return json as T;
}

interface RcConfigCreateResponse {
  State?: string;
  OAuthURL?: string;
  Option?: { Name: string; Help: string; Type: string; Exclusive: boolean };
}

// rclone's own non-OAuth housekeeping yes/no prompts - some come before config_token (deciding how
// to authorize at all), some after (refining the now-authorized remote) - auto-answered either way
// so callers of createRemote()/continueRemoteSetup() only ever see a real decision point: done, a
// genuine authUrl (rare, see RcloneRemoteSetupResult's doc comment), or the config_token prompt.
const AUTO_ANSWERED_PROMPTS: Record<string, string> = {
  // "Use web browser to automatically authenticate rclone with remote?" - rclone's default (Yes)
  // makes it try to open a browser and bind a callback listener on *this* machine, which hangs
  // forever on a headless server (confirmed live: a real request left running past two minutes
  // with nothing to ever complete it). Answering No instead routes to config_token, rclone's own
  // mechanism for exactly this case - see `rclone authorize`'s docs.
  config_is_local: 'false',
  // Google Drive-specific: "configure your own client id?" (rclone's shared one is being retired
  // during 2026) - default to No, same as leaving it blank in interactive `rclone config`. Doesn't
  // skip client_id/client_secret entirely though - confirmed live, Drive still asks for both right
  // after this regardless of the answer; those two get resolved below via `parameters` instead.
  config_shared_client_id: 'false',
  // Google Drive-specific, asked *after* config_token succeeds: "Configure this as a Shared Drive
  // (Team Drive)?" - No matches rclone's own default and is the right answer for a normal personal
  // Drive account, which is what this app's Connect flow is for; a Team Drive is a distinct, more
  // advanced setup an admin can still reach through the manual fields.
  config_change_team_drive: 'false',
};

const MAX_CONFIG_FLOW_STEPS = 8;

/**
 * Walks rclone's config/create state machine past every prompt this backend knows how to answer
 * on its own, stopping only once there's a real decision left for the admin: `done`, a genuine
 * `authUrl` (kept for completeness - no provider tested so far actually reaches this), or
 * `needsToken` (rclone's own `rclone authorize` paste-back mechanism, the one that actually works
 * for a remote/headless setup - see RcloneRemoteSetupResult's doc comment in types.ts for the full
 * reasoning, verified against rclone's own source, lib/oauthutil/oauthutil.go).
 *
 * Besides the fixed yes/no prompts in AUTO_ANSWERED_PROMPTS, rclone also asks for each OAuth
 * credential field (client_id, client_secret, ...) as its own separate step even when driven
 * non-interactively - confirmed live against Drive, which asks for both right after
 * config_shared_client_id regardless of that answer. Each one is answered from `parameters` (what
 * the admin already typed into the manual fields, same values createRemote() was called with) or
 * an empty string if the admin left it blank - confirmed live that rclone accepts an empty answer
 * here and falls back to its own shared client, exactly like leaving the field blank in `rclone
 * config` interactively.
 */
async function resolveConfigFlow(first: RcConfigCreateResponse, name: string, type: string, parameters: Record<string, string>): Promise<RcloneRemoteSetupResult> {
  let res = first;
  for (let step = 0; step < MAX_CONFIG_FLOW_STEPS; step++) {
    if (!res.State) return { done: true, authUrl: null, state: null, needsToken: false };
    if (res.OAuthURL) return { done: false, authUrl: res.OAuthURL, state: res.State, needsToken: false };

    const option = res.Option;
    const optionName = option?.Name;
    if (optionName === 'config_token') {
      return { done: false, authUrl: null, state: res.State, needsToken: true };
    }

    let answer = optionName ? AUTO_ANSWERED_PROMPTS[optionName] : undefined;
    // A plain (non yes/no) text field - answer with whatever the admin already typed for it, or
    // blank. Only for non-`Exclusive` fields (a real yes/no/multiple-choice prompt this app
    // doesn't recognize by name is a real unknown, not safe to guess blank for).
    if (answer === undefined && option && !option.Exclusive && option.Type === 'string') {
      answer = (optionName && parameters[optionName]) || '';
    }
    if (answer === undefined) {
      throw new Error(
        `"${type}" needs an extra setup step this app doesn't know how to answer automatically ("${optionName ?? 'unknown'}"${option?.Help ? `: ${option.Help.split('\n')[0]}` : ''}).`,
      );
    }
    res = await rcCall<RcConfigCreateResponse>('config/create', {
      name,
      type,
      parameters: {},
      opt: { nonInteractive: true, continue: true, state: res.State, result: answer },
    });
  }
  throw new Error(`"${type}" needed too many setup steps - aborting.`);
}

export class RealRcloneClient implements RcloneClient {
  async isInstalled(): Promise<boolean> {
    try {
      await execFileAsync(config.rcloneBin, ['version'], { timeout: 5_000 });
      return true;
    } catch (err) {
      if (isEnoent(err)) return false;
      return true; // present but errored for some other reason - still "installed"
    }
  }

  async ping(): Promise<boolean> {
    try {
      await rcCall('config/listremotes');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * `config/providers` is confirmed live (not just documented) to exist as an RC call, not only a
   * CLI subcommand - verified against a real `rclone rcd` instance on the test rig
   * (root@nonraid.lan, rclone v1.75.0): `curl -u user:pass -X POST
   * http://127.0.0.1:5572/config/providers` returned the full 69-provider list with the same
   * per-option schema `rclone config providers` prints, confirming the architecture notes'
   * "likely, but verify" question. Only non-advanced options are kept - see RcloneProvider's own
   * doc comment for why.
   */
  async listProviders(): Promise<RcloneProvider[]> {
    const { providers } = await rcCall<{ providers: RcProviderJson[] }>('config/providers');
    return providers.map((p) => ({
      name: p.Name,
      description: p.Description,
      // auth_url/token_url are rclone's own oauthutil-standard field names, present only on
      // providers that drive its OAuth web flow - confirmed live (dropbox/drive/onedrive/box/...
      // have both, always Advanced: true; sftp/s3/mega/sugarsync/... have neither). Checked against
      // the *raw* Options here, before the !Advanced filter below strips them out of what the
      // dynamic field form actually renders.
      oauth: p.Options.some((o) => o.Name === 'auth_url') && p.Options.some((o) => o.Name === 'token_url'),
      // !Advanced already drops most deprecated/internal fields (they're almost always also
      // marked Advanced) - the Hide check catches the rest, like drive's alternate_export, which
      // rclone marks deprecated but NOT advanced (confirmed live).
      options: p.Options.filter((o) => !o.Advanced && !(o.Hide & 2)).map(
        (o): RcloneProviderOption => ({
          name: o.Name,
          help: o.Help,
          default: o.Default === null || o.Default === undefined ? '' : String(o.Default),
          required: o.Required,
          isPassword: o.IsPassword,
          type: o.Type,
        }),
      ),
    }));
  }

  async listRemotes(): Promise<{ name: string; type: string }[]> {
    const dump = await rcCall<Record<string, { type?: string }>>('config/dump');
    return Object.entries(dump).map(([name, entry]) => ({ name, type: entry.type ?? 'unknown' }));
  }

  async getRemoteConfig(name: string): Promise<{ type: string; parameters: Record<string, string> }> {
    const dump = await rcCall<Record<string, Record<string, unknown>>>('config/dump');
    const entry = dump[name];
    if (!entry) throw new Error(`Remote "${name}" not found.`);
    const { type, ...rest } = entry;
    const parameters: Record<string, string> = {};
    for (const [key, value] of Object.entries(rest)) parameters[key] = String(value);
    return { type: String(type ?? 'unknown'), parameters };
  }

  async checkRemote(name: string): Promise<{ status: RcloneRemote['status']; message: string | null }> {
    try {
      await rcCall('operations/about', { fs: `${name}:` });
      return { status: 'ok', message: null };
    } catch (err) {
      const message = (err as Error).message;
      // rclone's own auth-expired errors mention "expired"/"invalid_grant"/"token" for the OAuth
      // backends (Drive, Dropbox, OneDrive, ...) - a heuristic, not a structured error code (rcd's
      // error responses are just {"error": "<message>"}), but good enough to surface the mockup's
      // "Auth expired" state instead of a flat "Error" for the common case.
      const authExpired = /expired|invalid_grant|oauth2:|token/i.test(message);
      return { status: authExpired ? 'authExpired' : 'error', message };
    }
  }

  async createRemote(name: string, type: string, parameters: Record<string, string>): Promise<RcloneRemoteSetupResult> {
    const res = await rcCall<RcConfigCreateResponse>('config/create', { name, type, parameters, opt: { nonInteractive: true } });
    return resolveConfigFlow(res, name, type, parameters);
  }

  async continueRemoteSetup(name: string, type: string, state: string, result: string): Promise<RcloneRemoteSetupResult> {
    const res = await rcCall<RcConfigCreateResponse>('config/create', {
      name,
      type,
      parameters: {},
      opt: { nonInteractive: true, continue: true, state, result },
    });
    // No `parameters` left to fall back on here - by the time the frontend calls this, the flow
    // has already reached config_token (the only state it ever hands back to the caller), so any
    // credential-field prompts (client_id, client_secret, ...) are already behind it.
    return resolveConfigFlow(res, name, type, {});
  }

  async updateRemote(name: string, parameters: Record<string, string>): Promise<void> {
    await rcCall('config/update', { name, parameters });
  }

  async deleteRemote(name: string): Promise<void> {
    await rcCall('config/delete', { name });
  }

  async startSync(opts: { srcFs: string; dstFs: string; mode: 'copy' | 'sync'; backupDir?: string }): Promise<{ jobId: number }> {
    const body: Record<string, unknown> = { srcFs: opts.srcFs, dstFs: opts.dstFs, _async: true };
    if (opts.backupDir) body.backupDir = opts.backupDir;
    const result = await rcCall<{ jobid: number }>(opts.mode === 'sync' ? 'sync/sync' : 'sync/copy', body);
    return { jobId: result.jobid };
  }

  async jobStatus(jobId: number): Promise<RcloneJobStatus> {
    const result = await rcCall<{ finished: boolean; success: boolean; error: string; id: number }>('job/status', { jobid: jobId });
    return { finished: result.finished, success: result.success, error: result.error, id: result.id };
  }

  async coreStats(group?: string): Promise<RcloneCoreStats> {
    const body = group ? { group } : {};
    const stats = await rcCall<{
      bytes?: number;
      totalBytes?: number;
      speed?: number;
      eta?: number | null;
      transferring?: { name: string; bytes: number; size: number }[];
      transfers?: number;
      totalTransfers?: number;
      errors?: number;
      lastError?: string;
    }>('core/stats', body);
    return {
      bytes: stats.bytes ?? 0,
      totalBytes: stats.totalBytes ?? 0,
      speed: stats.speed ?? 0,
      eta: stats.eta ?? null,
      transferring: stats.transferring,
      transfers: stats.transfers ?? 0,
      totalTransfers: stats.totalTransfers ?? 0,
      errors: stats.errors ?? 0,
      lastError: stats.lastError,
    };
  }

  async stopJob(jobId: number): Promise<void> {
    await rcCall('job/stop', { jobid: jobId });
  }

  async listDir(fs: string): Promise<RcloneDirEntry[]> {
    const { list } = await rcCall<{ list: { Path: string; Name: string; Size: number; ModTime: string; IsDir: boolean }[] }>('operations/list', { fs, remote: '' });
    return list.filter((e) => !e.IsDir).map((e) => ({ name: e.Name, path: e.Path, sizeBytes: e.Size, modTime: e.ModTime }));
  }

  async downloadFile(srcFs: string, srcRemote: string, dstFs: string, dstRemote: string): Promise<void> {
    await rcCall('operations/copyfile', { srcFs, srcRemote, dstFs, dstRemote });
  }

  async readFileText(fs: string, remote: string): Promise<string> {
    const stagingDir = await mkdtemp(path.join(os.tmpdir(), 'nonraid-rclone-read-'));
    try {
      await this.downloadFile(fs, remote, stagingDir, remote);
      return await readFile(path.join(stagingDir, remote), 'utf8');
    } finally {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async obscure(plaintext: string): Promise<string> {
    const result = await rcCall<{ obscured: string }>('core/obscure', { clear: plaintext });
    return result.obscured;
  }

  async reveal(obscured: string): Promise<string> {
    return revealRcloneObscured(obscured);
  }
}
