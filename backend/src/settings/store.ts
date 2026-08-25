import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { DEFAULT_EVENT_TYPES, type NotificationChannelToggle, type NotificationEventType } from './notificationCatalog.js';
import type { AppSettings, AppSettingsUpdate } from './types.js';

// A per-key deep merge for eventTypes - a patch touching only one channel (e.g. { webui: false })
// must not blow away the other channel's already-persisted value, unlike a shallow top-level
// spread would do now that each value is an object instead of a bare boolean.
function mergeEventTypes(
  base: Record<NotificationEventType, NotificationChannelToggle>,
  patch: Partial<Record<NotificationEventType, Partial<NotificationChannelToggle>>> | undefined,
): Record<NotificationEventType, NotificationChannelToggle> {
  if (!patch) return { ...base };
  const merged = { ...base };
  for (const key of Object.keys(patch) as NotificationEventType[]) {
    merged[key] = { ...base[key], ...patch[key] };
  }
  return merged;
}

// Normalizes a possibly-legacy eventTypes record on load: a bare boolean (the pre-split shape)
// becomes { apprise: <that boolean>, webui: true } - apprise carries over the old value exactly so
// existing Apprise preferences survive the migration untouched; webui defaults to true because the
// in-app activity feed it now gates was always unconditional before this toggle existed, so
// defaulting it off would silently mute toasts/bell entries users are already used to seeing.
// Already-object entries pass through unchanged.
function normalizeEventTypes(
  raw: Partial<Record<string, boolean | Partial<NotificationChannelToggle>>> | undefined,
): Partial<Record<NotificationEventType, NotificationChannelToggle>> {
  if (!raw) return {};
  const normalized: Partial<Record<NotificationEventType, NotificationChannelToggle>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'boolean') {
      normalized[key as NotificationEventType] = { apprise: value, webui: true };
    } else if (value) {
      normalized[key as NotificationEventType] = value as NotificationChannelToggle;
    }
  }
  return normalized;
}

const DEFAULTS: AppSettings = {
  timeFormat: '12h',
  turboWrite: false,
  trustProxy: false,
  trustProxyAddress: '',
  notifications: { enabled: false, appriseUrls: '', eventTypes: DEFAULT_EVENT_TYPES },
  minFreeSpaceGb: 4,
  paritySchedule: { enabled: false, frequency: 'weekly', dayOfWeek: 0, dayOfMonth: 1, hour: 2, cronExpression: '' },
  backupSchedule: {
    enabled: false,
    frequency: 'weekly',
    dayOfWeek: 0,
    dayOfMonth: 1,
    hour: 3,
    cronExpression: '',
    scope: 'config',
    destination: { mode: 'custom', diskSlot: null, customPath: '' },
    retain: 7,
    retainForever: false,
    encryption: { enabled: false, passwordObscured: null },
  },
  tempAlerts: { cpuWarnAboveCelsius: 55, diskWarnAboveCelsius: 55 },
  lxcStorage: { mode: 'boot', diskSlot: null },
  cache: { enabled: false, fsUuid: null },
  cacheSchedule: { enabled: false, frequency: 'weekly', dayOfWeek: 0, dayOfMonth: 1, hour: 3, cronExpression: '' },
  tailscale: { enabled: false, loginServer: '' },
  remoteBackup: { enabled: false },
  onboarding: { dismissed: false },
};

/**
 * Owns settings.json - mirrors shares/store.ts's pattern (in-memory cache,
 * writes serialized through one promise chain, atomic write-then-rename) for
 * the same reason: there's no external system that's authoritative for these
 * values, so this file is the only source of truth.
 */
export class SettingsStore {
  private cache: AppSettings | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private filePath: string = config.settingsConfigPath) {}

  async get(): Promise<AppSettings> {
    const settings = await this.load();
    return {
      ...settings,
      notifications: { ...settings.notifications, eventTypes: { ...settings.notifications.eventTypes } },
      paritySchedule: { ...settings.paritySchedule },
      backupSchedule: { ...settings.backupSchedule },
      tempAlerts: { ...settings.tempAlerts },
      lxcStorage: { ...settings.lxcStorage },
      cache: { ...settings.cache },
      cacheSchedule: { ...settings.cacheSchedule },
      tailscale: { ...settings.tailscale },
      remoteBackup: { ...settings.remoteBackup },
      onboarding: { ...settings.onboarding },
    };
  }

  update(patch: AppSettingsUpdate): Promise<AppSettings> {
    this.writeQueue = this.writeQueue.then(async () => {
      const current = await this.load();
      const next: AppSettings = {
        ...current,
        ...patch,
        notifications: {
          ...current.notifications,
          ...patch.notifications,
          eventTypes: mergeEventTypes(current.notifications.eventTypes, patch.notifications?.eventTypes),
        },
        paritySchedule: { ...current.paritySchedule, ...patch.paritySchedule },
        backupSchedule: {
          ...current.backupSchedule,
          ...patch.backupSchedule,
          destination: { ...current.backupSchedule.destination, ...patch.backupSchedule?.destination },
          encryption: { ...current.backupSchedule.encryption, ...patch.backupSchedule?.encryption },
        },
        tempAlerts: { ...current.tempAlerts, ...patch.tempAlerts },
        lxcStorage: { ...current.lxcStorage, ...patch.lxcStorage },
        cache: { ...current.cache, ...patch.cache },
        cacheSchedule: { ...current.cacheSchedule, ...patch.cacheSchedule },
        tailscale: { ...current.tailscale, ...patch.tailscale },
        remoteBackup: { ...current.remoteBackup, ...patch.remoteBackup },
        onboarding: { ...current.onboarding, ...patch.onboarding },
      };
      await this.persistAtomic(next);
    });
    return this.writeQueue.then(() => this.get());
  }

  private async load(): Promise<AppSettings> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      // One-time migration from the pre-split shape ({ warnAboveCelsius, enabled }) - seed both
      // new thresholds from whatever single value was already configured, rather than silently
      // resetting an existing deployment back to the 55°C default.
      const legacyTempAlerts = parsed.tempAlerts as { warnAboveCelsius?: number } | undefined;
      const migratedTempAlerts =
        legacyTempAlerts && typeof legacyTempAlerts.warnAboveCelsius === 'number'
          ? { cpuWarnAboveCelsius: legacyTempAlerts.warnAboveCelsius, diskWarnAboveCelsius: legacyTempAlerts.warnAboveCelsius }
          : undefined;
      // One-time migration from the pre-split single "tempAlert" toggle - seed both new toggles
      // from whatever was already configured, rather than silently re-enabling notifications an
      // existing deployment had turned off.
      const legacyEventTypes = parsed.notifications?.eventTypes as Partial<Record<string, boolean>> | undefined;
      const legacyTempAlertEnabled = legacyEventTypes?.tempAlert;
      const migratedEventTypes =
        typeof legacyTempAlertEnabled === 'boolean'
          ? {
              tempAlertCpu: { apprise: legacyTempAlertEnabled, webui: true },
              tempAlertDisk: { apprise: legacyTempAlertEnabled, webui: true },
            }
          : undefined;
      // One-time migration from the pre-restructure BackupSchedule shape (a bare `destDir: string`,
      // no `scope`/`destination`/`retainForever`) - an already-configured destination becomes the
      // equivalent 'custom' picker selection rather than silently resetting an existing install
      // back to an empty, unconfigured destination.
      const legacyBackupSchedule = parsed.backupSchedule as Partial<{ destDir: string }> | undefined;
      const migratedBackupDestination =
        typeof legacyBackupSchedule?.destDir === 'string' && legacyBackupSchedule.destDir
          ? { mode: 'custom' as const, diskSlot: null, customPath: legacyBackupSchedule.destDir }
          : undefined;
      this.cache = {
        ...DEFAULTS,
        ...parsed,
        notifications: {
          ...DEFAULTS.notifications,
          ...parsed.notifications,
          eventTypes: {
            ...DEFAULTS.notifications.eventTypes,
            ...migratedEventTypes,
            ...normalizeEventTypes(parsed.notifications?.eventTypes as Partial<Record<string, boolean | Partial<NotificationChannelToggle>>> | undefined),
          },
        },
        paritySchedule: { ...DEFAULTS.paritySchedule, ...parsed.paritySchedule },
        backupSchedule: {
          ...DEFAULTS.backupSchedule,
          ...parsed.backupSchedule,
          destination: { ...DEFAULTS.backupSchedule.destination, ...migratedBackupDestination, ...parsed.backupSchedule?.destination },
          encryption: { ...DEFAULTS.backupSchedule.encryption, ...parsed.backupSchedule?.encryption },
        },
        tempAlerts: { ...DEFAULTS.tempAlerts, ...migratedTempAlerts, ...parsed.tempAlerts },
        lxcStorage: { ...DEFAULTS.lxcStorage, ...parsed.lxcStorage },
        cache: { ...DEFAULTS.cache, ...parsed.cache },
        cacheSchedule: { ...DEFAULTS.cacheSchedule, ...parsed.cacheSchedule },
        tailscale: { ...DEFAULTS.tailscale, ...parsed.tailscale },
        remoteBackup: { ...DEFAULTS.remoteBackup, ...parsed.remoteBackup },
        onboarding: { ...DEFAULTS.onboarding, ...parsed.onboarding },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = { ...DEFAULTS };
      } else {
        throw err;
      }
    }
    return this.cache;
  }

  private async persistAtomic(settings: AppSettings): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
    await rename(tmp, this.filePath);
    this.cache = settings;
  }
}
