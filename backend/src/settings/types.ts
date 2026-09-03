import type { NotificationChannelToggle, NotificationEventType } from './notificationCatalog.js';

export interface NotificationSettings {
  // Master switch for the apprise channel specifically - the webui channel (bell/toast) has no
  // equivalent master switch, it's controlled purely per-event via eventTypes[type].webui below.
  enabled: boolean;
  // Apprise target URLs (https://github.com/caronc/apprise), space/newline
  // separated - e.g. "mailto://user:pass@gmail.com discord://webhook_id/token".
  // Stored as-is and passed straight through to the apprise CLI; this project
  // doesn't validate or understand individual service URL formats itself.
  appriseUrls: string;
  // Per-event, per-channel opt-in - see notificationCatalog.ts for the full event list,
  // severities, and defaults. .apprise is gated behind `enabled` above too (see notify.ts);
  // .webui has no master gate.
  eventTypes: Record<NotificationEventType, NotificationChannelToggle>;
}

export interface RecurringSchedule {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly' | 'cron';
  dayOfWeek: number; // 0 (Sun) - 6 (Sat), server local time - used when frequency is 'weekly'
  // 1-28 rather than 1-31: every month has at least 28 days, so this sidesteps
  // "the 30th doesn't exist in February" without needing month-length logic.
  dayOfMonth: number; // 1-28, server local time - used when frequency is 'monthly'
  hour: number; // 0-23, server local time - the only field that matters when frequency is 'daily'
  // Standard 5-field cron ("minute hour day month weekday") - only meaningful when frequency is
  // 'cron'; '' otherwise. Shared onto every RecurringSchedule (rather than only BackupSchedule)
  // so the same shape/matcher (cronMatch.ts) works for the remote sync jobs' own per-job schedule
  // too - Parity/Cache mover schedules just never offer the 'cron' option in their own UI.
  cronExpression: string;
}

export type ParitySchedule = RecurringSchedule;

// What a "Config backups" / "Config backups + appdata" backup scope covers - shared by Local
// Backups (BackupSchedule.scope below) and each Remote Backup sync job (rclone/types.ts's
// SyncJob.scope, which adds a third 'custom' option on top of these same two).
export type BackupScope = 'config' | 'configAppdata';

// Structured replacement for the old free-text destDir - same "mode + diskSlot" shape as
// StorageLocation (lxcStorage/StorageLocationField), so this reads the same way that picker
// already does elsewhere in Settings. resolveBackupDestDir() (system/backupDestination.ts) turns
// this into the actual absolute path BackupScheduler writes into.
export interface BackupDestination {
  mode: 'boot' | 'array' | 'custom';
  diskSlot: number | null; // meaningful only when mode === 'array'
  customPath: string; // meaningful only when mode === 'custom'
}

// Per-job password encryption (openssl enc, AES-256/PBKDF2) - shared shape between Local Backups'
// own schedule (BackupSchedule.encryption below) and each Remote Backup sync job (rclone/types.ts's
// SyncJob.encryption), one independent toggle+password per job rather than one shared app-wide
// password (see the handoff doc's "Password scope" decision). `passwordObscured` is rclone's own
// `core/obscure` output (RcloneClient.obscure()/reveal() - rclone/obscure.ts), never plaintext -
// stored so a scheduled/unattended run can reveal() it again without a human retyping it each
// time, same trust boundary as everything else in this app's root-readable config. null until a
// password has ever been saved; meaningless while `enabled` is false, but deliberately left in
// place rather than cleared when encryption is turned off, so turning it back on later without
// typing a new password just reuses the last one instead of forcing re-entry.
export interface BackupEncryption {
  enabled: boolean;
  passwordObscured: string | null;
}

export interface BackupSchedule extends RecurringSchedule {
  scope: BackupScope;
  destination: BackupDestination;
  retain: number; // how many past backups to keep; older ones are pruned after each successful run
  // When true, retain is ignored and nothing is ever pruned - same "keep all forever" override the
  // mockup gives Remote Backup's own retention field.
  retainForever: boolean;
  encryption: BackupEncryption;
}

// Mover schedule - no extra fields beyond the shared shape; unlike backups there's no destination
// to configure, the mover always drains /mnt/cache onto the array per each share's own disks.
export type CacheSchedule = RecurringSchedule;

export interface TempAlertSettings {
  // Separate CPU/disk thresholds - disks and CPU packages run at genuinely different normal
  // temperatures, so one shared number meant either nuisance-tripping on the CPU or never
  // catching a hot disk. No RAM threshold: this host has no memory temperature sensor at all
  // (only CPU hwmon drivers and per-disk SMART are read anywhere in this app - see cpuTemp.ts
  // and smart/service.ts), so there's nothing to compare a RAM threshold against.
  cpuWarnAboveCelsius: number;
  diskWarnAboveCelsius: number;
  // Whether this actually notifies is controlled by notifications.eventTypes.tempAlert (see
  // notificationCatalog.ts) - deliberately no separate enabled flag here: temperature watching
  // itself always runs, same as every other monitored condition in this app, and the catalog
  // toggle is the one on/off switch users see.
}

// Where LXC container storage lives - the one thing this app needs to remember about it, since
// config.lxcDefaultPath (the -P flag every lxc-* call gets) has no other source of truth and must
// survive an app restart. Docker's equivalent isn't persisted here at all - its real storage root
// lives in /etc/docker/daemon.json, so that file is read live instead (see docker/storagePath.ts).
export interface StorageLocation {
  mode: 'boot' | 'array' | 'cache' | 'custom';
  diskSlot: number | null; // meaningful only when mode === 'array'
  // meaningful only when mode === 'custom' - a full path typed directly, not a fixed subfolder
  // appended under a picked pool. A pool-picker + fixed "/system/docker" suffix (an earlier version
  // of this) breaks the moment a pool is itself named "system" (or any name the suffix collides
  // with) - confirmed live: picking pool "system" produced /mnt/user/system/system/lxc. Letting the
  // admin type the exact target instead sidesteps that class of collision entirely.
  customPath: string | null;
}

// The cache mirror's persisted identity - deliberately not raw /dev/sdX paths, which aren't stable
// across reboots (see cache/mount.ts, which resolves current device paths from this UUID fresh each
// time). `enabled` is separate from "is the mirror set up": setup (cache/service.ts's setup())
// mounts the filesystem permanently once done; this flag only controls whether shares actually
// write to it (see shares/applier/realApplier.ts's branchPaths()), so it can be toggled off without
// tearing the mirror down.
export interface CacheSettings {
  enabled: boolean;
  fsUuid: string | null;
}

// Tailscale, deliberately minimal: everything tailscaled itself already knows (connection state,
// assigned IPs, hostname, current SSH/DNS/routes flags) is read live from `tailscale status
// --json` instead of duplicated here - same "don't shadow an external source of truth" split as
// CacheSettings.enabled vs. the mirror's own live mount state. This only holds what tailscaled
// can't tell you before you've ever connected: whether the feature is switched on at all (hides
// the whole section and its Services row when off), and the login-server to pre-fill in the login
// form so a self-hosted Headscale user doesn't have to retype it every time.
export interface TailscaleSettings {
  enabled: boolean;
  loginServer: string; // '' = Tailscale's own coordination server; a URL = a self-hosted Headscale
}

// Remote Backup, deliberately as minimal as TailscaleSettings above: the rclone-rcd daemon itself
// is the source of truth for configured remotes (read live over its RC API, see rclone/), and each
// sync job's own definition/schedule lives in its own store (rclone/syncJobStore.ts, a growing list
// of structured records - a poor fit for settings.json's single-object-per-feature shape, same
// reasoning shares.json/tls.json get their own files instead of living in here). This only holds
// the one thing neither of those can tell you before the feature's ever been turned on: whether
// it's switched on at all - hides the whole section, and gates whether rclone-rcd.service is kept
// running, when off.
export interface RemoteBackupSettings {
  enabled: boolean;
}

// Tracks whether the first-run setup wizard (src/components/onboarding) has been dismissed or
// completed - a single flag rather than a per-step record, since resume position is always
// derived live from the array's actual state (see OnboardingWizard's deriveStartStep()), not
// stored here. Server-side rather than localStorage: this is a single-admin-account app, so
// "has this install been onboarded" is a property of the install, not the browser - it should
// stay resolved the same way from any device that logs in.
export interface OnboardingSettings {
  dismissed: boolean;
}

export interface AppSettings {
  // Clock display in the header - purely a formatting preference, doesn't affect any stored
  // timestamp (those stay server-local time throughout, same as every RecurringSchedule's hour).
  timeFormat: '12h' | '24h';
  // Desired state for the array's write method (nmdctl's md_write_method /
  // "turbo write") - see nmd/client.ts's setWriteMethod doc comment for why
  // this has to be persisted here rather than read back from the driver.
  turboWrite: boolean;
  // Mirrors config.trustProxy (see its doc comment) - either one being true enables it (a
  // TRUST_PROXY env var can still force it on without touching the UI). Applied live
  // via app.set('trust proxy', ...) in routes/settings.ts's PUT handler, no restart needed -
  // unlike TLS enable/disable, Express re-reads this setting on every request.
  trustProxy: boolean;
  // Which upstream hop actually gets its X-Forwarded-* headers trusted - IPs/CIDR ranges/the
  // named subnet keywords Express's trust-proxy setting understands, or a hostname (resolved to
  // its current IP at apply time, see auth/trustProxy.ts), comma/space-separated for more than
  // one. Empty string (the default) falls back to trusting every hop, same as trustProxy always
  // has - this only narrows that once actually filled in.
  trustProxyAddress: string;
  notifications: NotificationSettings;
  // mergerfs's `minfreespace`, in MB, applied to every pooled share mount
  // (see shares/applier/realApplier.ts). mergerfs excludes any branch below
  // this threshold from create-policy consideration - its own default is
  // 4096 (4G), a sane margin on real multi-TB disks but one that silently
  // makes every branch ineligible (ENOSPC on every write) on small disks.
  minFreeSpaceGb: number;
  // ATA standby timeout for HDD array disks (parity + data), in minutes - 0 means never. Applied
  // via hdparm -S (system/hdparm.ts's applySpinDownTimeout), reapplied on save/array-start/boot
  // since the drive's own timer doesn't persist across a power cycle.
  spinDownTimeoutMinutes: number;
  // User-chosen nicknames, keyed by NmdDisk.disk_id (a udev Model_Serial-style string - the same
  // stable cross-reboot identity nmd/realClient.ts already uses for re-import matching), not by
  // slot/device - those change across device-letter churn and disk swaps. Unrelated to the
  // array-wide "Array label" setting below (nmdctl's own concept, more like a hostname).
  diskLabels: Record<string, string>;
  // User-provided override for a Docker container's "Open" link, keyed by container name (not id -
  // that changes on every recreate, the container's name is what actually stays stable across an
  // update/edit the way this needs). Exists because the auto-detected URL (a CA template's own
  // WebUI field, or failing that a best-effort guess at the first published port - see
  // selectors/containers.ts's resolveContainerWebUi()) has no way to know which port is really the
  // UI for a manually-added container, or a CA container with more than one published port.
  containerWebUiUrls: Record<string, string>;
  paritySchedule: ParitySchedule;
  backupSchedule: BackupSchedule;
  tempAlerts: TempAlertSettings;
  lxcStorage: StorageLocation;
  cache: CacheSettings;
  cacheSchedule: CacheSchedule;
  tailscale: TailscaleSettings;
  remoteBackup: RemoteBackupSettings;
  onboarding: OnboardingSettings;
}

export type AppSettingsUpdate = Partial<{
  timeFormat: '12h' | '24h';
  turboWrite: boolean;
  trustProxy: boolean;
  trustProxyAddress: string;
  notifications: Partial<Omit<NotificationSettings, 'eventTypes'>> & {
    eventTypes?: Partial<Record<NotificationEventType, Partial<NotificationChannelToggle>>>;
  };
  minFreeSpaceGb: number;
  spinDownTimeoutMinutes: number;
  // A key mapped to '' removes that disk's label - see mergeDiskLabels() in store.ts.
  diskLabels: Partial<Record<string, string>>;
  // A key mapped to '' removes that container's URL override - same merge as diskLabels above.
  containerWebUiUrls: Partial<Record<string, string>>;
  paritySchedule: Partial<ParitySchedule>;
  backupSchedule: Partial<BackupSchedule>;
  tempAlerts: Partial<TempAlertSettings>;
  lxcStorage: Partial<StorageLocation>;
  cache: Partial<CacheSettings>;
  cacheSchedule: Partial<CacheSchedule>;
  tailscale: Partial<TailscaleSettings>;
  remoteBackup: Partial<RemoteBackupSettings>;
  onboarding: Partial<OnboardingSettings>;
}>;
