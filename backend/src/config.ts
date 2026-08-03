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
export type UsersMode = 'real' | 'mock';
export type LxcMode = 'real' | 'mock';

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
  // The file Browse page's own ceiling/starting point — independent of
  // shareMountRoot above (that one's for the Shares subsystem's own share
  // paths). Browse spans the whole /mnt tree (shares, individual array
  // disks, cache, etc.), not just one share, so it needs a wider root.
  browseRoot: process.env.BROWSE_ROOT ?? '/mnt',
  browseDefaultPath: process.env.BROWSE_DEFAULT_PATH ?? '/mnt/user',
  smbConfPath: process.env.SMB_CONF_PATH ?? '/etc/samba/smb.conf',
  exportsPath: process.env.EXPORTS_PATH ?? '/etc/exports',
  sharesUseSudo: envBool('SHARES_USE_SUDO', false),
  shareAccessConfigPath: process.env.SHARE_ACCESS_CONFIG_PATH ?? path.join(process.cwd(), 'data', 'share-access.json'),
  systemStatsIntervalMs: Number(process.env.SYSTEM_STATS_INTERVAL_MS ?? 2_000),
  usersMode: (process.env.USERS_MODE as UsersMode | undefined) ?? 'real',
  usersUseSudo: envBool('USERS_USE_SUDO', false),
  // Managed users/groups live in [start, end], so they're clearly distinguishable
  // from real host system accounts (never touches anything outside this range).
  // The upper bound matters as much as the lower one: 65534/65535 are the
  // classic reserved "nobody"/"nogroup"/overflow uid-gid values on Linux, and
  // an open-ended ">= start" check would wrongly treat those as app-managed.
  usersUidRangeStart: Number(process.env.USERS_UID_RANGE_START ?? 20_000),
  usersUidRangeEnd: Number(process.env.USERS_UID_RANGE_END ?? 59_999),
  usersTimeoutMs: Number(process.env.USERS_TIMEOUT_MS ?? 15_000),
  usersShellPath: process.env.USERS_SHELL_PATH ?? '/usr/sbin/nologin',
  // Community Applications template feed — see backend/src/apps/. Primary is
  // Unraid's own CDN; backup is the GitHub-hosted mirror the CA plugin itself
  // falls back to.
  appsFeedPrimaryUrl: process.env.APPS_FEED_PRIMARY_URL ?? 'https://assets.ca.unraid.net/feed/applicationFeed.json',
  appsFeedBackupUrl:
    process.env.APPS_FEED_BACKUP_URL ?? 'https://raw.githubusercontent.com/Squidly271/AppFeed/master/applicationFeed.json',
  appsFeedCachePath: process.env.APPS_FEED_CACHE_PATH ?? path.join(process.cwd(), 'data', 'ca-feed.json'),
  appsFeedRefreshIntervalMs: Number(process.env.APPS_FEED_REFRESH_INTERVAL_MS ?? 24 * 60 * 60 * 1000),
  // Host paths a container's volumes may bind-mount — shared by both Apps
  // (a CA template's "Path" Config entries) and the Docker tab's manual
  // Add/Edit Container dialog, since both end up calling the same
  // createContainer with caller-influenced host paths. Anything outside
  // these roots is rejected when building a plan — there's no auth layer in
  // front of this API yet, so it needs to be a hard boundary, not just a UI
  // warning.
  appsBindRoots: (process.env.APPS_BIND_ROOTS ?? process.env.SHARE_MOUNT_ROOT ?? '/mnt/user')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean),
  // App-level settings with no home elsewhere (turbo write's *desired* state,
  // notification config, the History page's Grafana URL) — see backend/src/settings/.
  settingsConfigPath: process.env.SETTINGS_CONFIG_PATH ?? path.join(process.cwd(), 'data', 'settings.json'),
  appriseBin: process.env.APPRISE_BIN ?? 'apprise',
  // Dashboard activity feed — see backend/src/activity/.
  activityConfigPath: process.env.ACTIVITY_CONFIG_PATH ?? path.join(process.cwd(), 'data', 'activity.json'),
  // How often the background watcher (backend/src/activity/watcher.ts) polls
  // for passive state changes (parity check completing on its own, a disk
  // erroring out, a SMART health check failing) worth logging on its own.
  activityWatcherIntervalMs: Number(process.env.ACTIVITY_WATCHER_INTERVAL_MS ?? 30_000),
  // LXC containers — see backend/src/lxc/. Shells out to the classic liblxc
  // `lxc-*` command-line tools (lxc-ls/lxc-info/lxc-create/...), the same
  // toolset ich777's unraid-lxc-plugin wraps in PHP. `lxcDefaultPath` is
  // passed as `-P` to every lxc-* call, matching that plugin's configurable
  // storage root (analogous to appsBindRoots above).
  lxcMode: (process.env.LXC_MODE as LxcMode | undefined) ?? 'real',
  lxcDefaultPath: process.env.LXC_DEFAULT_PATH ?? '/var/lib/lxc',
  lxcUseSudo: envBool('LXC_USE_SUDO', false),
  lxcTimeoutMs: Number(process.env.LXC_TIMEOUT_MS ?? 15_000),
  // lxc-create --template download fetches a rootfs tarball from
  // images.linuxcontainers.org — needs much longer than other lxc-* calls.
  lxcCreateTimeoutMs: Number(process.env.LXC_CREATE_TIMEOUT_MS ?? 10 * 60 * 1000),
  lxcStopTimeoutSec: Number(process.env.LXC_STOP_TIMEOUT_SEC ?? 30),
  // `lxc-create --template download -- --list` fetches the live image index
  // from the image server on a cold cache — the download template caches
  // it on disk afterward (~30ms on a warm cache, observed), but the first
  // call on a fresh host needs real network time.
  lxcDistroListTimeoutMs: Number(process.env.LXC_DISTRO_LIST_TIMEOUT_MS ?? 30_000),
  // Poll-and-cache interval for the CPU/memory/IP stats worker — see
  // lxc/statsPoller.ts, same shape as SystemStatsService.
  lxcStatsIntervalMs: Number(process.env.LXC_STATS_INTERVAL_MS ?? 3_000),
};
