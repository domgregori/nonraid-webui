import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { TailscaleClient } from './client.js';
import type { TailscaleBackendState, TailscaleLoginResult, TailscaleSetOptions, TailscaleStatus } from './types.js';

const execFileAsync = promisify(execFile);

const NOT_INSTALLED_STATUS: TailscaleStatus = {
  installed: false,
  backendState: null,
  loggedIn: false,
  hostname: null,
  dnsName: null,
  tailscaleIps: [],
  tailnetName: null,
  ssh: false,
  acceptDns: false,
  advertiseRoutes: [],
  acceptRoutes: false,
};

// Shapes below are the small slice of `tailscale status --json` / `tailscale debug prefs` this app
// actually reads - both commands return considerably more (per-peer capability maps, control-plane
// internals, ...) that nothing here needs.
interface StatusJson {
  BackendState?: string;
  Self?: { HostName?: string; DNSName?: string; TailscaleIPs?: string[] };
  CurrentTailnet?: { Name?: string } | null;
}

interface PrefsJson {
  Hostname?: string;
  RunSSH?: boolean;
  CorpDNS?: boolean;
  RouteAll?: boolean;
  AdvertiseRoutes?: string[] | null;
}

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export class RealTailscaleClient implements TailscaleClient {
  async getStatus(): Promise<TailscaleStatus> {
    let statusJson: StatusJson;
    try {
      const { stdout } = await execFileAsync('tailscale', ['status', '--json'], { timeout: 10_000 });
      statusJson = JSON.parse(stdout) as StatusJson;
    } catch (err) {
      if (isEnoent(err)) return NOT_INSTALLED_STATUS;
      // tailscaled not running, or `status` refused for some other reason - installed but stopped
      // is a completely normal state (e.g. right after `systemctl stop tailscaled`), not an error
      // this should throw for.
      return { ...NOT_INSTALLED_STATUS, installed: true, backendState: 'Stopped' };
    }

    let prefs: PrefsJson = {};
    try {
      const { stdout } = await execFileAsync('tailscale', ['debug', 'prefs'], { timeout: 10_000 });
      prefs = JSON.parse(stdout) as PrefsJson;
    } catch {
      // Prefs aren't readable in every backend state (e.g. NeedsLogin, before any prefs exist
      // yet) - the status fields above still stand on their own, so just fall back to defaults.
    }

    const backendState = (statusJson.BackendState ?? null) as TailscaleBackendState | null;
    return {
      installed: true,
      backendState,
      loggedIn: backendState === 'Running',
      hostname: statusJson.Self?.HostName ?? prefs.Hostname ?? null,
      dnsName: statusJson.Self?.DNSName ?? null,
      tailscaleIps: statusJson.Self?.TailscaleIPs ?? [],
      tailnetName: statusJson.CurrentTailnet?.Name ?? null,
      ssh: prefs.RunSSH ?? false,
      acceptDns: prefs.CorpDNS ?? false,
      advertiseRoutes: prefs.AdvertiseRoutes ?? [],
      acceptRoutes: prefs.RouteAll ?? false,
    };
  }

  login(loginServer?: string): Promise<TailscaleLoginResult> {
    const args = ['up'];
    if (loginServer) args.push(`--login-server=${loginServer}`);

    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn('tailscale', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        reject(isEnoent(err) ? new Error("'tailscale' not found - it isn't installed on this host.") : (err as Error));
        return;
      }

      let buffer = '';
      let settled = false;
      // `tailscale up` blocks until the browser flow completes (or times out on its own, usually
      // several minutes) when auth is needed - this promise only waits for the URL to appear in
      // its output, not for that whole flow. The child is deliberately left running afterward
      // (unref'd, not killed) so it can actually complete the handshake once the user finishes in
      // their browser; the frontend polls GET /tailscale/status to see when that happens.
      const urlTimeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`Timed out waiting for a login URL. Output so far:\n${buffer.trim()}`));
        }
      }, 20_000);

      const onData = (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const match = buffer.match(/(https?:\/\/\S+)/);
        if (match?.[1] && !settled) {
          settled = true;
          clearTimeout(urlTimeout);
          resolve({ authUrl: match[1] });
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(urlTimeout);
          reject(isEnoent(err) ? new Error("'tailscale' not found - it isn't installed on this host.") : err);
        }
      });
      child.on('exit', (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(urlTimeout);
          // No URL ever appeared and the process is done - either it was already authenticated
          // (code 0, nothing more to do) or it failed outright.
          if (code === 0) resolve({ authUrl: null });
          else reject(new Error(buffer.trim() || `tailscale up exited with code ${code}`));
        }
      });
      child.unref();
    });
  }

  async logout(): Promise<void> {
    await execFileAsync('tailscale', ['logout'], { timeout: 15_000 }).catch((err) => {
      throw isEnoent(err) ? new Error("'tailscale' not found - it isn't installed on this host.") : err;
    });
  }

  async setOptions(options: TailscaleSetOptions): Promise<void> {
    const args = ['set'];
    if (options.hostname !== undefined) args.push(`--hostname=${options.hostname}`);
    if (options.ssh !== undefined) args.push(`--ssh=${options.ssh}`);
    if (options.acceptDns !== undefined) args.push(`--accept-dns=${options.acceptDns}`);
    if (options.advertiseRoutes !== undefined) args.push(`--advertise-routes=${options.advertiseRoutes.join(',')}`);
    if (options.acceptRoutes !== undefined) args.push(`--accept-routes=${options.acceptRoutes}`);
    if (args.length === 1) return; // nothing to change

    await execFileAsync('tailscale', args, { timeout: 15_000 }).catch((err) => {
      if (isEnoent(err)) throw new Error("'tailscale' not found - it isn't installed on this host.");
      const e = err as { stderr?: string; message: string };
      throw new Error(e.stderr?.trim() || e.message);
    });
  }
}
