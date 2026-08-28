// Local CLI credential store - one JSON file, one admin-per-box the same way backend/src/auth's
// auth.json is one-admin-per-box. No write queue/atomic rename here (unlike auth/store.ts): this
// file is only ever touched by one interactive `nonraid login`/`logout` invocation at a time, never
// under concurrent request load the way the server's store is.
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface CliConfig {
  host: string; // e.g. "https://nonraid.lan" or "http://nonraid.lan:80" - includes protocol, no trailing slash
  token: string; // raw "nrd_..." bearer token, see backend/src/auth/crypto.ts's generateApiToken
  tokenId: string; // so `nonraid logout` can revoke the exact token server-side, not just forget it locally
  insecure?: boolean; // skip TLS certificate verification - for a self-signed cert host, see api/client.ts
}

const CONFIG_DIR = path.join(os.homedir(), '.config', 'nonraid-cli');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export function configPath(): string {
  return CONFIG_PATH;
}

export async function loadConfig(): Promise<CliConfig | null> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    return JSON.parse(raw) as CliConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

// Mode 0600 - this file holds a live bearer token, equivalent to a password. Set explicitly on
// every write rather than relying on umask, since umask varies by environment/CI.
export async function saveConfig(config: CliConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export async function clearConfig(): Promise<void> {
  await rm(CONFIG_PATH, { force: true });
}
