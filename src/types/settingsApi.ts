// Mirrors backend/src/settings/types.ts. Keep in sync.
import type { StorageLocation } from './storagePath';

export type NotificationEventType =
  | 'diskFailed'
  | 'diskErrors'
  | 'smartFailed'
  | 'parityErrors'
  | 'backupFailed'
  | 'tempAlertCpu'
  | 'tempAlertDisk'
  | 'diskAdded'
  | 'arrayReconfigured'
  | 'parityStarted'
  | 'parityCompleted'
  | 'backupCompleted'
  | 'arrayStarted'
  | 'arrayStopped'
  | 'cacheMirrorDegraded'
  | 'cacheMoverFailed'
  | 'cacheMoverCompleted';

export type NotificationSeverity = 'high' | 'medium' | 'low';

export interface NotificationEventDef {
  id: NotificationEventType;
  label: string;
  severity: NotificationSeverity;
  defaultEnabled: boolean;
}

export interface NotificationSettings {
  enabled: boolean;
  appriseUrls: string;
  eventTypes: Record<NotificationEventType, boolean>;
}

export interface RecurringSchedule {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  dayOfWeek: number; // 0 (Sun) – 6 (Sat), server local time — used when frequency is 'weekly'
  dayOfMonth: number; // 1–28, server local time — used when frequency is 'monthly'
  hour: number; // 0–23, server local time — the only field that matters when frequency is 'daily'
}

export type ParitySchedule = RecurringSchedule;

export interface BackupSchedule extends RecurringSchedule {
  destDir: string;
  retain: number;
}

export type CacheSchedule = RecurringSchedule;

export interface TempAlertSettings {
  cpuWarnAboveCelsius: number;
  diskWarnAboveCelsius: number;
}

export interface CacheSettings {
  enabled: boolean;
  fsUuid: string | null;
}

export interface AppSettings {
  turboWrite: boolean;
  notifications: NotificationSettings;
  minFreeSpaceMb: number;
  paritySchedule: ParitySchedule;
  backupSchedule: BackupSchedule;
  tempAlerts: TempAlertSettings;
  lxcStorage: StorageLocation;
  cache: CacheSettings;
  cacheSchedule: CacheSchedule;
}

export type AppSettingsUpdate = Partial<{
  turboWrite: boolean;
  notifications: Partial<Omit<NotificationSettings, 'eventTypes'>> & {
    eventTypes?: Partial<Record<NotificationEventType, boolean>>;
  };
  minFreeSpaceMb: number;
  paritySchedule: Partial<ParitySchedule>;
  backupSchedule: Partial<BackupSchedule>;
  tempAlerts: Partial<TempAlertSettings>;
  lxcStorage: Partial<StorageLocation>;
  cache: Partial<CacheSettings>;
  cacheSchedule: Partial<CacheSchedule>;
}>;

export interface CommandResult {
  ok: boolean;
  message: string;
}
