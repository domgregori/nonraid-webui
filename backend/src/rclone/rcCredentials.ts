import { readFile } from 'node:fs/promises';
import { config } from '../config.js';

export interface RcloneRcCredentials {
  user: string;
  pass: string;
}

// Cached after the first successful read - this file is only ever written once, by
// tools/install-webui.sh's ensure_rclone() (a random password generated on first install), never
// rewritten afterward, so there's nothing to invalidate the cache for.
let cached: RcloneRcCredentials | null = null;

/** Parses the systemd EnvironmentFile rclone-rcd.service and this backend both read (see
 *  config.ts's rcloneRcEnvFilePath doc comment) - plain KEY=VALUE lines, no quoting/escaping to
 *  worry about since install-webui.sh only ever writes a fixed username and a hex password into
 *  it. Missing file (rclone never installed) or missing keys both resolve to null rather than
 *  throwing - callers treat that as "Remote Backup isn't set up on this host yet", the same
 *  graceful-degradation shape TailscaleClient uses for a missing `tailscale` binary. */
export async function getRcloneRcCredentials(): Promise<RcloneRcCredentials | null> {
  if (cached) return cached;
  let raw: string;
  try {
    raw = await readFile(config.rcloneRcEnvFilePath, 'utf8');
  } catch {
    return null;
  }
  const vars: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) vars[match[1]!] = match[2]!.trim();
  }
  if (!vars.RCLONE_RC_USER || !vars.RCLONE_RC_PASS) return null;
  cached = { user: vars.RCLONE_RC_USER, pass: vars.RCLONE_RC_PASS };
  return cached;
}
