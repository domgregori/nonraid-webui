import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { hasCloudflaredToken } from './tokenStore.js';
import type { CloudflaredClient } from './client.js';
import type { CloudflaredStatus } from './types.js';

const execFileAsync = promisify(execFile);

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export class RealCloudflaredClient implements CloudflaredClient {
  async getStatus(): Promise<CloudflaredStatus> {
    const hasToken = await hasCloudflaredToken();

    let version: string | null = null;
    try {
      const { stdout } = await execFileAsync(config.cloudflaredBin, ['--version'], { timeout: 10_000 });
      version = stdout.trim();
    } catch (err) {
      if (isEnoent(err)) return { installed: false, version: null, running: false, hasToken };
      // Installed but --version failed for some other reason - treat as installed-but-unknown
      // rather than "not installed", same defensive shape RealTailscaleClient uses when `status`
      // itself refuses for a reason other than ENOENT.
      return { installed: true, version: null, running: false, hasToken };
    }

    let running = false;
    try {
      // Exits non-zero (with stdout "inactive"/"failed"/"unknown") for anything other than a
      // genuinely active unit - that's a normal, expected outcome here (the tunnel is
      // installed-but-off by default, same as tailscaled/rclone-rcd), not an error worth
      // surfacing.
      const { stdout } = await execFileAsync('systemctl', ['is-active', config.cloudflaredServiceName], { timeout: 5_000 });
      running = stdout.trim() === 'active';
    } catch {
      running = false;
    }

    return { installed: true, version, running, hasToken };
  }
}
