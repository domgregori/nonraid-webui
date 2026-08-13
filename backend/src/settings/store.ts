import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { DEFAULT_EVENT_TYPES } from './notificationCatalog.js';
import type { AppSettings, AppSettingsUpdate } from './types.js';

const DEFAULTS: AppSettings = {
  turboWrite: false,
  notifications: { enabled: false, appriseUrls: '', eventTypes: DEFAULT_EVENT_TYPES },
  minFreeSpaceMb: 100,
  paritySchedule: { enabled: false, frequency: 'weekly', dayOfWeek: 0, dayOfMonth: 1, hour: 2 },
  backupSchedule: { enabled: false, frequency: 'weekly', dayOfWeek: 0, dayOfMonth: 1, hour: 3, destDir: '', retain: 7 },
  tempAlerts: { cpuWarnAboveCelsius: 55, diskWarnAboveCelsius: 55 },
  lxcStorage: { mode: 'boot', diskSlot: null },
  cache: { enabled: false, fsUuid: null },
  cacheSchedule: { enabled: false, frequency: 'weekly', dayOfWeek: 0, dayOfMonth: 1, hour: 3 },
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
          eventTypes: { ...current.notifications.eventTypes, ...patch.notifications?.eventTypes },
        },
        paritySchedule: { ...current.paritySchedule, ...patch.paritySchedule },
        backupSchedule: { ...current.backupSchedule, ...patch.backupSchedule },
        tempAlerts: { ...current.tempAlerts, ...patch.tempAlerts },
        lxcStorage: { ...current.lxcStorage, ...patch.lxcStorage },
        cache: { ...current.cache, ...patch.cache },
        cacheSchedule: { ...current.cacheSchedule, ...patch.cacheSchedule },
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
          ? { tempAlertCpu: legacyTempAlertEnabled, tempAlertDisk: legacyTempAlertEnabled }
          : undefined;
      this.cache = {
        ...DEFAULTS,
        ...parsed,
        notifications: {
          ...DEFAULTS.notifications,
          ...parsed.notifications,
          eventTypes: { ...DEFAULTS.notifications.eventTypes, ...migratedEventTypes, ...parsed.notifications?.eventTypes },
        },
        paritySchedule: { ...DEFAULTS.paritySchedule, ...parsed.paritySchedule },
        backupSchedule: { ...DEFAULTS.backupSchedule, ...parsed.backupSchedule },
        tempAlerts: { ...DEFAULTS.tempAlerts, ...migratedTempAlerts, ...parsed.tempAlerts },
        lxcStorage: { ...DEFAULTS.lxcStorage, ...parsed.lxcStorage },
        cache: { ...DEFAULTS.cache, ...parsed.cache },
        cacheSchedule: { ...DEFAULTS.cacheSchedule, ...parsed.cacheSchedule },
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
