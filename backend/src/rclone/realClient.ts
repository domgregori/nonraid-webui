import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import type { RcloneClient, RcloneCoreStats, RcloneJobStatus } from './client.js';
import { revealRcloneObscured } from './obscure.js';
import { getRcloneRcCredentials } from './rcCredentials.js';
import type { RcloneDirEntry, RcloneProvider, RcloneProviderOption, RcloneRemote } from './types.js';

const execFileAsync = promisify(execFile);

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

// The subset of rclone's own `config/providers` response shape this client actually reads -
// confirmed live against rclone v1.75.0 (see backend/src/rclone/realClient.ts's doc comment on
// listProviders for how this was verified). Real responses have several more fields per option
// (Hide, Exclusive, Sensitive, Examples, ...) nothing here uses.
interface RcProviderOptionJson {
  Name: string;
  Help: string;
  Default: unknown;
  Required: boolean;
  IsPassword: boolean;
  Advanced: boolean;
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
      options: p.Options.filter((o) => !o.Advanced).map(
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

  async createRemote(name: string, type: string, parameters: Record<string, string>): Promise<{ done: boolean; authUrl: string | null; state: string | null }> {
    const result = await rcCall<{ State?: string; OAuthURL?: string }>('config/create', { name, type, parameters, opt: { nonInteractive: true } });
    return { done: !result.State, authUrl: result.OAuthURL ?? null, state: result.State ?? null };
  }

  async continueRemoteSetup(name: string, type: string, state: string): Promise<{ done: boolean; authUrl: string | null; state: string | null }> {
    const result = await rcCall<{ State?: string; OAuthURL?: string }>('config/create', {
      name,
      type,
      parameters: {},
      opt: { nonInteractive: true, continue: true, state },
    });
    return { done: !result.State, authUrl: result.OAuthURL ?? null, state: result.State ?? null };
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
