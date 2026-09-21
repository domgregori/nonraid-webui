import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

const TOKEN_KEY = 'CLOUDFLARED_TUNNEL_TOKEN';

/**
 * Reads/writes the systemd EnvironmentFile tools/systemd/cloudflared-tunnel.service's own
 * ExecStart also reads (`cloudflared tunnel run --token ${CLOUDFLARED_TUNNEL_TOKEN}`) - same
 * "generated secret, not a user preference, so it never lives in settings.json" precedent as
 * rcloneRcEnvFilePath, except this one this backend actively writes too (PUT /cloudflared/token,
 * step-up gated - see routes/cloudflared.ts) rather than only reading a value install-webui.sh
 * generated once. 0600, so only this backend's own root process can read the raw token back.
 */
async function readVars(): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(config.cloudflaredTokenEnvFilePath, 'utf8');
  } catch {
    return {};
  }
  const vars: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) vars[match[1]!] = match[2]!.trim();
  }
  return vars;
}

export async function hasCloudflaredToken(): Promise<boolean> {
  const vars = await readVars();
  return Boolean(vars[TOKEN_KEY]);
}

export async function setCloudflaredToken(token: string): Promise<void> {
  await mkdir(path.dirname(config.cloudflaredTokenEnvFilePath), { recursive: true });
  await writeFile(config.cloudflaredTokenEnvFilePath, `${TOKEN_KEY}=${token}\n`, 'utf8');
  await chmod(config.cloudflaredTokenEnvFilePath, 0o600);
}
