import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseToml, TomlError, type TomlTable, type TomlValue } from 'smol-toml';

/**
 * Structured config file, checked in this order - whichever is found first is
 * the only one read (not merged): $HOME/.config/nonraid/config.toml (for a
 * non-root dev run, or the systemd service's own $HOME, typically /root),
 * then /etc/nonraid/config.toml (the usual production location, see
 * tools/config/nonraid-webui.toml.example). Neither existing falls back to
 * today's behavior - env vars / hardcoded defaults only, same as before this
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
      throw err; // e.g. EACCES - a real misconfiguration, not "no file present"
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
// isn't itself a table) as "not set" rather than throwing - a syntactically
// valid TOML file with the wrong shape for one key falls through to that
// key's hardcoded default, same as a wrong-typed env var does today.
function t(section: string, key: string): TomlValue | undefined {
  const sec = toml[section];
  if (typeof sec !== 'object' || sec === null || Array.isArray(sec)) return undefined;
  return (sec as TomlTable)[key];
}

// Every config value resolves env var (if set) > TOML value (if the winning
// file sets it) > hardcoded fallback. Env vars stay authoritative so quick
// ad hoc overrides keep working (e.g. `PORT=4000 npm run dev`) - TOML is
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

// See appsBindRoots below - resolved once, ahead of the object literal, so
// both its own field and appsBindRoots's cross-key fallback can reuse the one
// already-precedence-resolved value instead of re-running env/TOML lookup twice.
const shareMountRoot = str('SHARE_MOUNT_ROOT', t('shares', 'mount_root'), '/mnt/user');

export const config = {
  port: num('PORT', t('server', 'port'), 3001),
  corsOrigin: str('CORS_ORIGIN', t('server', 'cors_origin'), 'http://localhost:5183'),
  // When true, this backend also serves the frontend's built static files
  // (and falls back to index.html for client-side routes) from this same
  // Express instance - the production deployment shape, see
  // tools/systemd/nonraid-webui.service. Must stay false for today's dev
  // setup, where Vite's own dev server serves the frontend separately on
  // its own origin/port (see corsOrigin above).
  serveFrontend: bool('SERVE_FRONTEND', t('server', 'serve_frontend'), false),
  // Only enable when a reverse proxy is the *sole* way to reach this backend (it's firewalled off
  // from any other direct access) and that proxy always sets/overwrites X-Forwarded-Proto/Host/For
  // itself - otherwise a direct client could spoof those headers to fake an HTTPS connection or
  // dodge IP-based rate limiting. When true, Express trusts them (see index.ts's app.set('trust
  // proxy', ...)), which lets cookieSecure/webauthnRpId/webauthnOrigin below be derived from the
  // real request instead of requiring cookie_secure/webauthn_rp_id/webauthn_origin to be set by
  // hand - see requestOrigin.ts.
  trustProxy: bool('TRUST_PROXY', t('server', 'trust_proxy'), false),
  // Absolute path to the frontend's built dist/ output (`npm run build` at
  // the repo root - Vite's default outDir, see vite.config.ts). Only read
  // when serveFrontend is true.
  frontendDistPath: str('FRONTEND_DIST_PATH', t('server', 'frontend_dist_path'), path.join(process.cwd(), 'frontend-dist')),
  // Single admin account - see backend/src/auth/.
  authConfigPath: str('AUTH_CONFIG_PATH', t('auth', 'config_path'), path.join(process.cwd(), 'data', 'auth.json')),
  // MUST be true once real TLS termination exists in front of this backend -
  // see REQUIREMENTS.md's Security section. false is only correct
  // for a non-TLS dev/test setup; a Secure cookie sent over plain HTTP is
  // simply dropped by the browser, silently breaking login. index.ts flips
  // this to true automatically at boot when this app's own built-in TLS
  // (backend/src/tls/) is enabled - this manual default only still matters
  // for a reverse-proxy-terminated-TLS setup that also leaves trustProxy off;
  // with trustProxy on, the real per-request protocol (via requestOrigin.ts)
  // already covers this and this manual override becomes optional, not required.
  cookieSecure: bool('COOKIE_SECURE', t('auth', 'cookie_secure'), false),
  sessionTtlMs: num('SESSION_TTL_MS', t('auth', 'session_ttl_ms'), 30 * 24 * 60 * 60 * 1000),
  loginRateLimitWindowMs: num('LOGIN_RATE_LIMIT_WINDOW_MS', t('auth', 'login_rate_limit_window_ms'), 15 * 60 * 1000),
  loginRateLimitMax: num('LOGIN_RATE_LIMIT_MAX', t('auth', 'login_rate_limit_max'), 10),
  // How long a "password verified, second factor pending" cookie stays valid - short on purpose,
  // this is a narrower window than a real session and doesn't need session-length TTLs.
  twoFactorPendingTtlMs: num('TWO_FACTOR_PENDING_TTL_MS', t('auth', 'two_factor_pending_ttl_ms'), 5 * 60 * 1000),
  totpRateLimitWindowMs: num('TOTP_RATE_LIMIT_WINDOW_MS', t('auth', 'totp_rate_limit_window_ms'), 15 * 60 * 1000),
  totpRateLimitMax: num('TOTP_RATE_LIMIT_MAX', t('auth', 'totp_rate_limit_max'), 10),
  // Unset by default - passkey routes 400 with a clear message until both are set, unless
  // trustProxy is on, in which case requireWebauthnConfig() derives them from the request instead
  // (see requestOrigin.ts). Unlike cookieSecure, there's no safe *static* default to guess here:
  // RP ID/origin are inherently per-deployment (bare domain vs full scheme+host+port), and
  // guessing wrong doesn't just silently break a feature, it risks accepting assertions bound to
  // the wrong origin - that's why this stays a manual override rather than ever being inferred
  // when trustProxy is off.
  webauthnRpId: optStr('WEBAUTHN_RP_ID', t('auth', 'webauthn_rp_id')),
  webauthnOrigin: optStr('WEBAUTHN_ORIGIN', t('auth', 'webauthn_origin')),
  // HTTPS termination - see backend/src/tls/. Metadata lives in tlsConfigPath, the actual PEM
  // material under tlsCertDir (never embedded in the JSON record).
  tlsConfigPath: str('TLS_CONFIG_PATH', t('tls', 'config_path'), path.join(process.cwd(), 'data', 'tls.json')),
  tlsCertDir: str('TLS_CERT_DIR', t('tls', 'cert_dir'), path.join(process.cwd(), 'data', 'tls')),
  // Self-signed certs never chain to a public trust store, so the shrinking lifetime caps public
  // CAs must follow (825 days and falling) don't apply - long-lived by default so a headless NAS
  // admin isn't nagged to regenerate one every year.
  tlsSelfSignedDays: num('TLS_SELF_SIGNED_DAYS', t('tls', 'self_signed_days'), 3650),
  opensslBin: str('OPENSSL_BIN', t('tls', 'openssl_bin'), 'openssl'),
  nmdBin: str('NMD_BIN', t('nmd', 'bin'), 'nmdctl'),
  nmdTimeoutMs: num('NMD_TIMEOUT_MS', t('nmd', 'timeout_ms'), 15_000),
  // nmdctl's own `unassign` has an unconditional interactive confirm prompt with
  // no unattended bypass, so unassign writes this driver command directly instead
  // (see docs/manual-management.md in the main nonraid repo).
  nmdCmdPath: str('NMD_CMD_PATH', t('nmd', 'cmd_path'), '/proc/nmdcmd'),
  smartctlBin: str('SMARTCTL_BIN', t('smart', 'bin'), 'smartctl'),
  smartTimeoutMs: num('SMART_TIMEOUT_MS', t('smart', 'timeout_ms'), 10_000),
  smartCacheTtlMs: num('SMART_CACHE_TTL_MS', t('smart', 'cache_ttl_ms'), 60_000),
  // Attribute/self-test reads are on-demand (a disk's detail panel open), not
  // polled continuously like temperature - short TTL so self-test progress
  // (see smart/service.ts) shows up promptly without hammering smartctl.
  smartAttributesCacheTtlMs: num('SMART_ATTRIBUTES_CACHE_TTL_MS', t('smart', 'attributes_cache_ttl_ms'), 4_000),
  // Spin up/down actions (backend/src/system/hdparm.ts) - not bundled with this project, same
  // "clear error if missing" treatment appriseBin/smartctlBin get rather than a hard crash.
  hdparmBin: str('HDPARM_BIN', t('hdparm', 'bin'), 'hdparm'),
  sharesConfigPath: str('SHARES_CONFIG_PATH', t('shares', 'config_path'), path.join(process.cwd(), 'data', 'shares.json')),
  shareMountRoot,
  // The file Browse page's own ceiling/starting point - independent of
  // shareMountRoot above (that one's for the Shares subsystem's own share
  // paths). Browse spans the whole /mnt tree (shares, individual array
  // disks, cache, etc.), not just one share, so it needs a wider root.
  browseRoot: str('BROWSE_ROOT', t('browse', 'root'), '/mnt'),
  browseDefaultPath: str('BROWSE_DEFAULT_PATH', t('browse', 'default_path'), '/mnt/user'),
  smbConfPath: str('SMB_CONF_PATH', t('shares', 'smb_conf_path'), '/etc/samba/smb.conf'),
  exportsPath: str('EXPORTS_PATH', t('shares', 'exports_path'), '/etc/exports'),
  shareAccessConfigPath: str('SHARE_ACCESS_CONFIG_PATH', t('shares', 'access_config_path'), path.join(process.cwd(), 'data', 'share-access.json')),
  systemStatsIntervalMs: num('SYSTEM_STATS_INTERVAL_MS', t('system', 'stats_interval_ms'), 2_000),
  // Managed users/groups live in [start, end], so they're clearly distinguishable
  // from real host system accounts (never touches anything outside this range).
  // The upper bound matters as much as the lower one: 65534/65535 are the
  // classic reserved "nobody"/"nogroup"/overflow uid-gid values on Linux, and
  // an open-ended ">= start" check would wrongly treat those as app-managed.
  usersUidRangeStart: num('USERS_UID_RANGE_START', t('users', 'uid_range_start'), 20_000),
  usersUidRangeEnd: num('USERS_UID_RANGE_END', t('users', 'uid_range_end'), 59_999),
  usersTimeoutMs: num('USERS_TIMEOUT_MS', t('users', 'timeout_ms'), 15_000),
  usersShellPath: str('USERS_SHELL_PATH', t('users', 'shell_path'), '/usr/sbin/nologin'),
  // Community Applications template feed - see backend/src/apps/. Primary is
  // the feed's own CDN; backup is the GitHub-hosted mirror the CA plugin itself
  // falls back to.
  appsFeedPrimaryUrl: str('APPS_FEED_PRIMARY_URL', t('apps', 'feed_primary_url'), 'https://assets.ca.unraid.net/feed/applicationFeed.json'),
  appsFeedBackupUrl: str(
    'APPS_FEED_BACKUP_URL',
    t('apps', 'feed_backup_url'),
    'https://raw.githubusercontent.com/Squidly271/AppFeed/master/applicationFeed.json',
  ),
  appsFeedCachePath: str('APPS_FEED_CACHE_PATH', t('apps', 'feed_cache_path'), path.join(process.cwd(), 'data', 'ca-feed.json')),
  appsFeedRefreshIntervalMs: num('APPS_FEED_REFRESH_INTERVAL_MS', t('apps', 'feed_refresh_interval_ms'), 24 * 60 * 60 * 1000),
  // Host paths a container's volumes may bind-mount - shared by both Apps
  // (a CA template's "Path" Config entries) and the Docker tab's manual
  // Add/Edit Container dialog, since both end up calling the same
  // createContainer with caller-influenced host paths. Anything outside
  // these roots is rejected when building a plan - there's no auth layer in
  // front of this API yet, so it needs to be a hard boundary, not just a UI
  // warning.
  appsBindRoots: strArray('APPS_BIND_ROOTS', t('apps', 'bind_roots'), [shareMountRoot]),
  // App-level settings with no home elsewhere (turbo write's *desired* state,
  // notification config) - see backend/src/settings/.
  settingsConfigPath: str('SETTINGS_CONFIG_PATH', t('settings', 'config_path'), path.join(process.cwd(), 'data', 'settings.json')),
  appriseBin: str('APPRISE_BIN', t('settings', 'apprise_bin'), 'apprise'),
  // Dashboard activity feed - see backend/src/activity/.
  activityConfigPath: str('ACTIVITY_CONFIG_PATH', t('activity', 'config_path'), path.join(process.cwd(), 'data', 'activity.json')),
  // How often the background watcher (backend/src/activity/watcher.ts) polls
  // for passive state changes (parity check completing on its own, a disk
  // erroring out, a SMART health check failing) worth logging on its own.
  activityWatcherIntervalMs: num('ACTIVITY_WATCHER_INTERVAL_MS', t('activity', 'watcher_interval_ms'), 30_000),
  // How often the weekly/monthly background schedulers (ParityScheduler,
  // BackupScheduler) check their stored schedule against the current time.
  // A 1-minute tick is plenty for an hour-granularity schedule - no cron
  // dependency needed for either.
  schedulerTickIntervalMs: num('SCHEDULER_TICK_INTERVAL_MS', t('scheduler', 'tick_interval_ms'), 60_000),
  // LXC containers - see backend/src/lxc/. Shells out to the classic liblxc
  // `lxc-*` command-line tools (lxc-ls/lxc-info/lxc-create/...), the same
  // toolset a well-known community LXC plugin wraps in PHP. `lxcDefaultPath` is
  // passed as `-P` to every lxc-* call, matching that plugin's configurable
  // storage root (analogous to appsBindRoots above).
  lxcDefaultPath: str('LXC_DEFAULT_PATH', t('lxc', 'default_path'), '/var/lib/lxc'),
  lxcTimeoutMs: num('LXC_TIMEOUT_MS', t('lxc', 'timeout_ms'), 15_000),
  // lxc-create --template download fetches a rootfs tarball from
  // images.linuxcontainers.org - needs much longer than other lxc-* calls.
  lxcCreateTimeoutMs: num('LXC_CREATE_TIMEOUT_MS', t('lxc', 'create_timeout_ms'), 10 * 60 * 1000),
  lxcStopTimeoutSec: num('LXC_STOP_TIMEOUT_SEC', t('lxc', 'stop_timeout_sec'), 30),
  // `lxc-create --template download -- --list` fetches the live image index
  // from the image server on a cold cache - the download template caches
  // it on disk afterward (~30ms on a warm cache, observed), but the first
  // call on a fresh host needs real network time.
  lxcDistroListTimeoutMs: num('LXC_DISTRO_LIST_TIMEOUT_MS', t('lxc', 'distro_list_timeout_ms'), 30_000),
  // Poll-and-cache interval for the CPU/memory/IP stats worker - see
  // lxc/statsPoller.ts, same shape as SystemStatsService.
  lxcStatsIntervalMs: num('LXC_STATS_INTERVAL_MS', t('lxc', 'stats_interval_ms'), 3_000),
  // First-party history (History page) - see backend/src/metrics/. Independent
  // of the live-UI poll intervals above: those are for "what's happening right
  // now", this is "what happened over time", sampled far less often on purpose.
  metricsDbPath: str('METRICS_DB_PATH', t('metrics', 'db_path'), path.join(process.cwd(), 'data', 'metrics.db')),
  metricsSampleIntervalMs: num('METRICS_SAMPLE_INTERVAL_MS', t('metrics', 'sample_interval_ms'), 60_000),
  metricsRetentionDays: num('METRICS_RETENTION_DAYS', t('metrics', 'retention_days'), 30),
  // Mirrored cache pool (btrfs RAID1) - see backend/src/cache/. A single fixed
  // mountpoint, unlike shareMountRoot/browseRoot which are roots for many
  // per-name paths underneath them.
  cacheMountPoint: str('CACHE_MOUNT_POINT', t('cache', 'mount_point'), '/mnt/cache'),
  cacheTimeoutMs: num('CACHE_TIMEOUT_MS', t('cache', 'timeout_ms'), 15_000),
  // mkfs.btrfs against a real multi-TB disk pair can take a while - longer
  // than every other privileged command in this app, none of which format a
  // filesystem from scratch.
  cacheMkfsTimeoutMs: num('CACHE_MKFS_TIMEOUT_MS', t('cache', 'mkfs_timeout_ms'), 5 * 60 * 1000),
  // Array/pool/cache data ownership (see shares/applier/realApplier.ts's mountShare(),
  // cache/mount.ts's mountCache(), and writeSmbBlock()/writeExportsBlock()'s force
  // user/group and anonuid/anongid) - the classic linuxserver.io nobody:users
  // (99:100) convention most Community-Apps containers already default their own
  // PUID/PGID to. Named "user" rather than "nobody" here since Debian's own nobody
  // account is a fixed uid 65534, not 99 - that name's already taken, so this app
  // provisions its own account for the 99 slot instead (see tools/install-webui.sh).
  // The numeric uid/gid are kept alongside the names since NFS's anonuid/anongid
  // export options only accept numbers, not account names.
  arrayDataOwner: 'user',
  arrayDataGroup: 'users',
  arrayDataUid: 99,
  arrayDataGid: 100,
  // Remote Backup (rclone) - see backend/src/rclone/. The daemon (rclone-rcd.service, installed by
  // tools/install-webui.sh's ensure_rclone()) binds to loopback only; its RC user/pass live in
  // rcloneRcEnvFilePath (an EnvironmentFile the systemd unit's own ExecStart also reads, so both
  // sides always agree - see rclone/rcCredentials.ts) rather than settings.json, since it's a
  // generated secret, not a user preference.
  rcloneRcUrl: str('RCLONE_RC_URL', t('rclone', 'rc_url'), 'http://127.0.0.1:5572'),
  rcloneRcEnvFilePath: str('RCLONE_RC_ENV_FILE_PATH', t('rclone', 'rc_env_file_path'), '/etc/default/rclone-rcd'),
  rcloneRcTimeoutMs: num('RCLONE_RC_TIMEOUT_MS', t('rclone', 'rc_timeout_ms'), 15_000),
  rcloneBin: str('RCLONE_BIN', t('rclone', 'bin'), 'rclone'),
  // rclone's own config file - every configured remote (S3/B2/SFTP/etc credentials, obscured not
  // encrypted) lives here, entirely outside this app's own settings.json. Must match rclone-rcd's
  // own --config= flag (tools/systemd/rclone-rcd.service) and install-webui.sh's `mkdir -p` for
  // it - not templated from this value since the systemd unit file is static, so keep both in
  // sync by hand if this ever changes. Included in config backups (see backupCatalog.ts's
  // 'remoteBackup' category) alongside rcloneSyncJobsConfigPath below - restoring one without the
  // other leaves either orphaned sync jobs with no matching remote, or remotes with no job using
  // them.
  rcloneConfigPath: str('RCLONE_CONFIG_PATH', t('rclone', 'config_path'), '/etc/rclone/rclone.conf'),
  // The sync-job list (rclone/syncJobStore.ts) - a growing list of structured records, same reason
  // shares.json/tls.json get their own file instead of living inside settings.json.
  rcloneSyncJobsConfigPath: str('RCLONE_SYNC_JOBS_CONFIG_PATH', t('rclone', 'sync_jobs_config_path'), path.join(process.cwd(), 'data', 'rclone-sync-jobs.json')),
  // How often RcloneSyncScheduler checks every sync job's own schedule against the current time -
  // same 1-minute cadence as BackupScheduler/ParityScheduler, fine-grained enough for a 'cron'
  // schedule's minute-level precision.
  rcloneSchedulerTickIntervalMs: num('RCLONE_SCHEDULER_TICK_INTERVAL_MS', t('rclone', 'scheduler_tick_interval_ms'), 60_000),
  // How often UpdateScheduler re-checks GitHub for a newer tagged release of nonraid/nonraid-webui
  // (see update/service.ts) - a git ls-remote per component, not worth doing anywhere near as
  // often as the minute-granularity schedulers above; once a day is plenty for something a human
  // finds out about via a notification, not a live status they're staring at.
  updateSchedulerTickIntervalMs: num('UPDATE_SCHEDULER_TICK_INTERVAL_MS', t('update', 'scheduler_tick_interval_ms'), 24 * 60 * 60 * 1000),
  // Absolute path to the nonraid-webui git checkout's own tools/install-webui.sh - what "Update
  // Now" (POST /update/apply) spawns to actually pull/build/stage an update. Defaults to
  // nonraid-os's first-boot script's own CHECKOUT_DIR, the real location on an actual deployed
  // image - override for any other checkout location (e.g. a dev/test box).
  updateInstallScriptPath: str('UPDATE_INSTALL_SCRIPT_PATH', t('update', 'install_script_path'), '/opt/nonraid-webui-src/tools/install-webui.sh'),
  // How often DockerUpdateScheduler re-pulls every container's image to check for a newer one
  // (see docker/updateCheck.ts) - a real registry hit per container, so daily by default like the
  // update scheduler above, not the minute-granularity schedulers.
  dockerUpdateSchedulerTickIntervalMs: num('DOCKER_UPDATE_SCHEDULER_TICK_INTERVAL_MS', t('docker', 'update_scheduler_tick_interval_ms'), 24 * 60 * 60 * 1000),
};
