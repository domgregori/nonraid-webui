import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseToml, TomlError, type TomlTable, type TomlValue } from 'smol-toml';

/**
 * Structured config file, checked in this order — whichever is found first is
 * the only one read (not merged): $HOME/.config/nonraid/config.toml (for a
 * non-root dev run, or the systemd service's own $HOME, typically /root),
 * then /etc/nonraid/config.toml (the usual production location, see
 * tools/config/nonraid-webui.toml.example). Neither existing falls back to
 * today's behavior — env vars / hardcoded defaults only, same as before this
 * existed. A missing file is fine; a file that exists but fails to parse is a
 * real misconfiguration and must throw at boot, same as every JSON-backed
 * store in this codebase (AuthStore, ShareStore, SettingsStore, ...) failing
 * loud on a corrupt file rather than silently reverting to empty state.
 */
function loadTomlConfig(): TomlTable {
  const candidates = [path.join(os.homedir(), '.config', 'nonraid', 'config.toml'), '/etc/nonraid/config.toml'];
  for (const candidate of candidates) {
    let raw: string;
    try {
      raw = readFileSync(candidate, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err; // e.g. EACCES — a real misconfiguration, not "no file present"
    }
    try {
      return parseToml(raw);
    } catch (err) {
      if (err instanceof TomlError) {
        throw new Error(`Malformed TOML config at ${candidate}: ${err.message} (line ${err.line}, column ${err.column})`, { cause: err });
      }
      throw err;
    }
  }
  return {};
}

const toml = loadTomlConfig();

// Tolerates a missing/malformed table (undefined section, or a section that
// isn't itself a table) as "not set" rather than throwing — a syntactically
// valid TOML file with the wrong shape for one key falls through to that
// key's hardcoded default, same as a wrong-typed env var does today.
function t(section: string, key: string): TomlValue | undefined {
  const sec = toml[section];
  if (typeof sec !== 'object' || sec === null || Array.isArray(sec)) return undefined;
  return (sec as TomlTable)[key];
}

// Every config value resolves env var (if set) > TOML value (if the winning
// file sets it) > hardcoded fallback. Env vars stay authoritative so quick
// ad hoc overrides keep working (e.g. `PORT=4000 npm run dev`) — TOML is
// the preferred *durable* surface, layered underneath.
function str(envName: string, tomlValue: TomlValue | undefined, fallback: string): string {
  const envVal = process.env[envName];
  if (envVal !== undefined) return envVal;
  if (typeof tomlValue === 'string') return tomlValue;
  return fallback;
}
function optStr(envName: string, tomlValue: TomlValue | undefined): string | undefined {
  const envVal = process.env[envName];
  if (envVal !== undefined) return envVal;
  return typeof tomlValue === 'string' ? tomlValue : undefined;
}
function num(envName: string, tomlValue: TomlValue | undefined, fallback: number): number {
  const envVal = process.env[envName];
  if (envVal !== undefined) return Number(envVal);
  return typeof tomlValue === 'number' ? tomlValue : fallback;
}
function bool(envName: string, tomlValue: TomlValue | undefined, fallback: boolean): boolean {
  const envVal = process.env[envName];
  if (envVal !== undefined) return envVal === '1' || envVal.toLowerCase() === 'true';
  return typeof tomlValue === 'boolean' ? tomlValue : fallback;
}
function strArray(envName: string, tomlValue: TomlValue | undefined, fallback: string[]): string[] {
  const envVal = process.env[envName];
  if (envVal !== undefined) return envVal.split(',').map((p) => p.trim()).filter(Boolean);
  if (Array.isArray(tomlValue)) return tomlValue.filter((v): v is string => typeof v === 'string');
  return fallback;
}

// See appsBindRoots below — resolved once, ahead of the object literal, so
// both its own field and appsBindRoots's cross-key fallback can reuse the one
// already-precedence-resolved value instead of re-running env/TOML lookup twice.
const shareMountRoot = str('SHARE_MOUNT_ROOT', t('shares', 'mount_root'), '/mnt/user');

export const config = {
  port: num('PORT', t('server', 'port'), 3001),
  corsOrigin: str('CORS_ORIGIN', t('server', 'cors_origin'), 'http://localhost:5183'),
  // When true, this backend also serves the frontend's built static files
  // (and falls back to index.html for client-side routes) from this same
  // Express instance — the production deployment shape, see
  // tools/systemd/nonraid-webui.service. Must stay false for today's dev
  // setup, where Vite's own dev server serves the frontend separately on
  // its own origin/port (see corsOrigin above).
  serveFrontend: bool('SERVE_FRONTEND', t('server', 'serve_frontend'), false),
  // Absolute path to the frontend's built dist/ output (`npm run build` at
  // the repo root — Vite's default outDir, see vite.config.ts). Only read
  // when serveFrontend is true.
  frontendDistPath: str('FRONTEND_DIST_PATH', t('server', 'frontend_dist_path'), path.join(process.cwd(), 'frontend-dist')),
  // Single admin account — see backend/src/auth/.
  authConfigPath: str('AUTH_CONFIG_PATH', t('auth', 'config_path'), path.join(process.cwd(), 'data', 'auth.json')),
  // MUST be true once real TLS termination exists in front of this backend —
  // see ../nonraid/REQUIREMENTS.md's Security section. false is only correct
  // for the current non-TLS dev/test setup; a Secure cookie sent over plain
  // HTTP is simply dropped by the browser, silently breaking login.
  cookieSecure: bool('COOKIE_SECURE', t('auth', 'cookie_secure'), false),
  sessionTtlMs: num('SESSION_TTL_MS', t('auth', 'session_ttl_ms'), 30 * 24 * 60 * 60 * 1000),
  loginRateLimitWindowMs: num('LOGIN_RATE_LIMIT_WINDOW_MS', t('auth', 'login_rate_limit_window_ms'), 15 * 60 * 1000),
  loginRateLimitMax: num('LOGIN_RATE_LIMIT_MAX', t('auth', 'login_rate_limit_max'), 10),
  nmdBin: str('NMD_BIN', t('nmd', 'bin'), 'nmdctl'),
  nmdSuperblock: optStr('NMD_SUPERBLOCK', t('nmd', 'superblock')), // optional -s override, undefined = nmdctl default
  nmdUseSudo: bool('NMD_USE_SUDO', t('nmd', 'use_sudo'), false),
  nmdTimeoutMs: num('NMD_TIMEOUT_MS', t('nmd', 'timeout_ms'), 15_000),
  // nmdctl's own `unassign` has an unconditional interactive confirm prompt with
  // no unattended bypass, so unassign writes this driver command directly instead
  // (see docs/manual-management.md in the main nonraid repo).
  nmdCmdPath: str('NMD_CMD_PATH', t('nmd', 'cmd_path'), '/proc/nmdcmd'),
  smartctlBin: str('SMARTCTL_BIN', t('smart', 'bin'), 'smartctl'),
  smartUseSudo: bool('SMART_USE_SUDO', t('smart', 'use_sudo'), false),
  smartTimeoutMs: num('SMART_TIMEOUT_MS', t('smart', 'timeout_ms'), 10_000),
  smartCacheTtlMs: num('SMART_CACHE_TTL_MS', t('smart', 'cache_ttl_ms'), 60_000),
  // Attribute/self-test reads are on-demand (a disk's detail panel open), not
  // polled continuously like temperature — short TTL so self-test progress
  // (see smart/service.ts) shows up promptly without hammering smartctl.
  smartAttributesCacheTtlMs: num('SMART_ATTRIBUTES_CACHE_TTL_MS', t('smart', 'attributes_cache_ttl_ms'), 4_000),
  sharesConfigPath: str('SHARES_CONFIG_PATH', t('shares', 'config_path'), path.join(process.cwd(), 'data', 'shares.json')),
  shareMountRoot,
  // The file Browse page's own ceiling/starting point — independent of
  // shareMountRoot above (that one's for the Shares subsystem's own share
  // paths). Browse spans the whole /mnt tree (shares, individual array
  // disks, cache, etc.), not just one share, so it needs a wider root.
  browseRoot: str('BROWSE_ROOT', t('browse', 'root'), '/mnt'),
  browseDefaultPath: str('BROWSE_DEFAULT_PATH', t('browse', 'default_path'), '/mnt/user'),
  smbConfPath: str('SMB_CONF_PATH', t('shares', 'smb_conf_path'), '/etc/samba/smb.conf'),
  exportsPath: str('EXPORTS_PATH', t('shares', 'exports_path'), '/etc/exports'),
  sharesUseSudo: bool('SHARES_USE_SUDO', t('shares', 'use_sudo'), false),
  shareAccessConfigPath: str('SHARE_ACCESS_CONFIG_PATH', t('shares', 'access_config_path'), path.join(process.cwd(), 'data', 'share-access.json')),
  systemStatsIntervalMs: num('SYSTEM_STATS_INTERVAL_MS', t('system', 'stats_interval_ms'), 2_000),
  // Boot disk backups (backend/src/system/backupStream.ts) shell out to dd/tar
  // to read raw block devices and root-owned config files — same "this
  // process may not itself have permission, only sudo does" reasoning as
  // nmdUseSudo/sharesUseSudo/usersUseSudo.
  systemUseSudo: bool('SYSTEM_USE_SUDO', t('system', 'use_sudo'), false),
  usersUseSudo: bool('USERS_USE_SUDO', t('users', 'use_sudo'), false),
  // Managed users/groups live in [start, end], so they're clearly distinguishable
  // from real host system accounts (never touches anything outside this range).
  // The upper bound matters as much as the lower one: 65534/65535 are the
  // classic reserved "nobody"/"nogroup"/overflow uid-gid values on Linux, and
  // an open-ended ">= start" check would wrongly treat those as app-managed.
  usersUidRangeStart: num('USERS_UID_RANGE_START', t('users', 'uid_range_start'), 20_000),
  usersUidRangeEnd: num('USERS_UID_RANGE_END', t('users', 'uid_range_end'), 59_999),
  usersTimeoutMs: num('USERS_TIMEOUT_MS', t('users', 'timeout_ms'), 15_000),
  usersShellPath: str('USERS_SHELL_PATH', t('users', 'shell_path'), '/usr/sbin/nologin'),
  // Community Applications template feed — see backend/src/apps/. Primary is
  // Unraid's own CDN; backup is the GitHub-hosted mirror the CA plugin itself
  // falls back to.
  appsFeedPrimaryUrl: str('APPS_FEED_PRIMARY_URL', t('apps', 'feed_primary_url'), 'https://assets.ca.unraid.net/feed/applicationFeed.json'),
  appsFeedBackupUrl: str(
    'APPS_FEED_BACKUP_URL',
    t('apps', 'feed_backup_url'),
    'https://raw.githubusercontent.com/Squidly271/AppFeed/master/applicationFeed.json',
  ),
  appsFeedCachePath: str('APPS_FEED_CACHE_PATH', t('apps', 'feed_cache_path'), path.join(process.cwd(), 'data', 'ca-feed.json')),
  appsFeedRefreshIntervalMs: num('APPS_FEED_REFRESH_INTERVAL_MS', t('apps', 'feed_refresh_interval_ms'), 24 * 60 * 60 * 1000),
  // Host paths a container's volumes may bind-mount — shared by both Apps
  // (a CA template's "Path" Config entries) and the Docker tab's manual
  // Add/Edit Container dialog, since both end up calling the same
  // createContainer with caller-influenced host paths. Anything outside
  // these roots is rejected when building a plan — there's no auth layer in
  // front of this API yet, so it needs to be a hard boundary, not just a UI
  // warning.
  appsBindRoots: strArray('APPS_BIND_ROOTS', t('apps', 'bind_roots'), [shareMountRoot]),
  // App-level settings with no home elsewhere (turbo write's *desired* state,
  // notification config) — see backend/src/settings/.
  settingsConfigPath: str('SETTINGS_CONFIG_PATH', t('settings', 'config_path'), path.join(process.cwd(), 'data', 'settings.json')),
  appriseBin: str('APPRISE_BIN', t('settings', 'apprise_bin'), 'apprise'),
  // Dashboard activity feed — see backend/src/activity/.
  activityConfigPath: str('ACTIVITY_CONFIG_PATH', t('activity', 'config_path'), path.join(process.cwd(), 'data', 'activity.json')),
  // How often the background watcher (backend/src/activity/watcher.ts) polls
  // for passive state changes (parity check completing on its own, a disk
  // erroring out, a SMART health check failing) worth logging on its own.
  activityWatcherIntervalMs: num('ACTIVITY_WATCHER_INTERVAL_MS', t('activity', 'watcher_interval_ms'), 30_000),
  // LXC containers — see backend/src/lxc/. Shells out to the classic liblxc
  // `lxc-*` command-line tools (lxc-ls/lxc-info/lxc-create/...), the same
  // toolset ich777's unraid-lxc-plugin wraps in PHP. `lxcDefaultPath` is
  // passed as `-P` to every lxc-* call, matching that plugin's configurable
  // storage root (analogous to appsBindRoots above).
  lxcDefaultPath: str('LXC_DEFAULT_PATH', t('lxc', 'default_path'), '/var/lib/lxc'),
  lxcUseSudo: bool('LXC_USE_SUDO', t('lxc', 'use_sudo'), false),
  lxcTimeoutMs: num('LXC_TIMEOUT_MS', t('lxc', 'timeout_ms'), 15_000),
  // lxc-create --template download fetches a rootfs tarball from
  // images.linuxcontainers.org — needs much longer than other lxc-* calls.
  lxcCreateTimeoutMs: num('LXC_CREATE_TIMEOUT_MS', t('lxc', 'create_timeout_ms'), 10 * 60 * 1000),
  lxcStopTimeoutSec: num('LXC_STOP_TIMEOUT_SEC', t('lxc', 'stop_timeout_sec'), 30),
  // `lxc-create --template download -- --list` fetches the live image index
  // from the image server on a cold cache — the download template caches
  // it on disk afterward (~30ms on a warm cache, observed), but the first
  // call on a fresh host needs real network time.
  lxcDistroListTimeoutMs: num('LXC_DISTRO_LIST_TIMEOUT_MS', t('lxc', 'distro_list_timeout_ms'), 30_000),
  // Poll-and-cache interval for the CPU/memory/IP stats worker — see
  // lxc/statsPoller.ts, same shape as SystemStatsService.
  lxcStatsIntervalMs: num('LXC_STATS_INTERVAL_MS', t('lxc', 'stats_interval_ms'), 3_000),
  // First-party history (History page) — see backend/src/metrics/. Independent
  // of the live-UI poll intervals above: those are for "what's happening right
  // now", this is "what happened over time", sampled far less often on purpose.
  metricsDbPath: str('METRICS_DB_PATH', t('metrics', 'db_path'), path.join(process.cwd(), 'data', 'metrics.db')),
  metricsSampleIntervalMs: num('METRICS_SAMPLE_INTERVAL_MS', t('metrics', 'sample_interval_ms'), 60_000),
  metricsRetentionDays: num('METRICS_RETENTION_DAYS', t('metrics', 'retention_days'), 30),
};
