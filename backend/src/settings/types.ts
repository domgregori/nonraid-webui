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
  frequency: 'daily' | 'weekly' | 'monthly';
  dayOfWeek: number; // 0 (Sun) - 6 (Sat), server local time - used when frequency is 'weekly'
  // 1-28 rather than 1-31: every month has at least 28 days, so this sidesteps
  // "the 30th doesn't exist in February" without needing month-length logic.
  dayOfMonth: number; // 1-28, server local time - used when frequency is 'monthly'
  hour: number; // 0-23, server local time - the only field that matters when frequency is 'daily'
}

export type ParitySchedule = RecurringSchedule;

export interface BackupSchedule extends RecurringSchedule {
  destDir: string; // absolute path to write backups into - should be on the array, not the boot disk
  retain: number; // how many past backups to keep; older ones are pruned after each successful run
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
  mode: 'boot' | 'array' | 'cache';
  diskSlot: number | null; // meaningful only when mode === 'array'
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
  // Mirrors config.trustProxy (see its doc comment) - either one being true enables it (an
  // env var/config.toml deployment can still force it on without touching the UI). Applied live
  // via app.set('trust proxy', ...) in routes/settings.ts's PUT handler, no restart needed -
  // unlike TLS enable/disable, Express re-reads this setting on every request.
  trustProxy: boolean;
  notifications: NotificationSettings;
  // mergerfs's `minfreespace`, in MB, applied to every pooled share mount
  // (see shares/applier/realApplier.ts). mergerfs excludes any branch below
  // this threshold from create-policy consideration - its own default is
  // 4096 (4G), a sane margin on real multi-TB disks but one that silently
  // makes every branch ineligible (ENOSPC on every write) on small disks.
  minFreeSpaceGb: number;
  paritySchedule: ParitySchedule;
  backupSchedule: BackupSchedule;
  tempAlerts: TempAlertSettings;
  lxcStorage: StorageLocation;
  cache: CacheSettings;
  cacheSchedule: CacheSchedule;
  tailscale: TailscaleSettings;
  onboarding: OnboardingSettings;
}

export type AppSettingsUpdate = Partial<{
  timeFormat: '12h' | '24h';
  turboWrite: boolean;
  trustProxy: boolean;
  notifications: Partial<Omit<NotificationSettings, 'eventTypes'>> & {
    eventTypes?: Partial<Record<NotificationEventType, Partial<NotificationChannelToggle>>>;
  };
  minFreeSpaceGb: number;
  paritySchedule: Partial<ParitySchedule>;
  backupSchedule: Partial<BackupSchedule>;
  tempAlerts: Partial<TempAlertSettings>;
  lxcStorage: Partial<StorageLocation>;
  cache: Partial<CacheSettings>;
  cacheSchedule: Partial<CacheSchedule>;
  tailscale: Partial<TailscaleSettings>;
  onboarding: Partial<OnboardingSettings>;
}>;
