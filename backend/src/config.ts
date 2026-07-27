import path from 'node:path';

try {
  process.loadEnvFile('.env');
} catch {
  // no .env file — fine, all vars have defaults below
}

// 'real' is the default and only picks mock when a person sets MODE=mock by hand.
// No 'auto' — the system must not switch to mock data by itself.
export type NmdMode = 'real' | 'mock';
export type DockerMode = 'real' | 'mock';
export type SmartMode = 'real' | 'mock';
export type SharesMode = 'real' | 'mock';

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === '1' || v.toLowerCase() === 'true';
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5183',
  nmdMode: (process.env.NMD_MODE as NmdMode | undefined) ?? 'real',
  nmdBin: process.env.NMD_BIN ?? 'nmdctl',
  nmdSuperblock: process.env.NMD_SUPERBLOCK, // optional -s override, undefined = nmdctl default
  nmdUseSudo: envBool('NMD_USE_SUDO', false),
  nmdTimeoutMs: Number(process.env.NMD_TIMEOUT_MS ?? 15_000),
  // nmdctl's own `unassign` has an unconditional interactive confirm prompt with
  // no unattended bypass, so unassign writes this driver command directly instead
  // (see docs/manual-management.md in the main nonraid repo).
  nmdCmdPath: process.env.NMD_CMD_PATH ?? '/proc/nmdcmd',
  dockerMode: (process.env.DOCKER_MODE as DockerMode | undefined) ?? 'real',
  smartMode: (process.env.SMART_MODE as SmartMode | undefined) ?? 'real',
  smartctlBin: process.env.SMARTCTL_BIN ?? 'smartctl',
  smartUseSudo: envBool('SMART_USE_SUDO', false),
  smartTimeoutMs: Number(process.env.SMART_TIMEOUT_MS ?? 10_000),
  smartCacheTtlMs: Number(process.env.SMART_CACHE_TTL_MS ?? 60_000),
  sharesMode: (process.env.SHARES_MODE as SharesMode | undefined) ?? 'real',
  sharesConfigPath: process.env.SHARES_CONFIG_PATH ?? path.join(process.cwd(), 'data', 'shares.json'),
  shareMountRoot: process.env.SHARE_MOUNT_ROOT ?? '/mnt/user',
  smbConfPath: process.env.SMB_CONF_PATH ?? '/etc/samba/smb.conf',
  exportsPath: process.env.EXPORTS_PATH ?? '/etc/exports',
  sharesUseSudo: envBool('SHARES_USE_SUDO', false),
  systemStatsIntervalMs: Number(process.env.SYSTEM_STATS_INTERVAL_MS ?? 2_000),
};
