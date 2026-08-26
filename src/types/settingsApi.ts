// Mirrors backend/src/settings/types.ts. Keep in sync.
import type { StorageLocation } from './storagePath';

export type NotificationEventType =
  | 'arrayError'
  | 'diskFailed'
  | 'diskErrors'
  | 'smartFailed'
  | 'parityErrors'
  | 'backupFailed'
  | 'tempAlertCpu'
  | 'tempAlertDisk'
  | 'diskAdded'
  | 'arrayReconfigured'
  | 'diskNeedsFormat'
  | 'parityStarted'
  | 'parityCompleted'
  | 'backupCompleted'
  | 'arrayStarted'
  | 'arrayStopped'
  | 'cacheMirrorDegraded'
  | 'cacheMoverFailed'
  | 'cacheMoverCompleted'
  | 'updateAvailable'
  | 'dockerUpdateAvailable';

export type NotificationSeverity = 'high' | 'medium' | 'low';

export interface NotificationEventDef {
  id: NotificationEventType;
  label: string;
  severity: NotificationSeverity;
  defaultEnabled: boolean;
  // Consecutive events sharing the same group render together inside one bordered box - see
  // NotificationEventToggles.
  group?: string;
}

export interface NotificationChannelToggle {
  apprise: boolean;
  webui: boolean;
}

export interface NotificationSettings {
  enabled: boolean;
  appriseUrls: string;
  eventTypes: Record<NotificationEventType, NotificationChannelToggle>;
}

export interface RecurringSchedule {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly' | 'cron';
  dayOfWeek: number; // 0 (Sun) - 6 (Sat), server local time - used when frequency is 'weekly'
  dayOfMonth: number; // 1-28, server local time - used when frequency is 'monthly'
  hour: number; // 0-23, server local time - the only field that matters when frequency is 'daily'
  cronExpression: string; // 5-field cron, only meaningful when frequency is 'cron'
}

export type ParitySchedule = RecurringSchedule;

export type BackupScope = 'config' | 'configAppdata';

export interface BackupDestination {
  mode: 'boot' | 'array' | 'custom';
  diskSlot: number | null;
  customPath: string;
}

// What the server actually returns for Local Backups' own encryption state - never the real
// (obscured) password, see backend/src/settings/backupEncryption.ts's redactEncryption() doc
// comment. `hasPassword` drives a "leave blank to keep the current password" placeholder instead
// of an empty-looks-unset field when a password's already saved.
export interface BackupEncryption {
  enabled: boolean;
  hasPassword: boolean;
}

// The write shape sent on PUT /settings - `password` is plaintext and write-only (never
// round-tripped back, see BackupEncryption above), and only actually required the first time
// `enabled` turns on with nothing saved yet; blank/omitted on a later save means "keep the
// current saved password".
export interface BackupEncryptionInput {
  enabled?: boolean;
  password?: string;
}

export interface BackupSchedule extends RecurringSchedule {
  scope: BackupScope;
  destination: BackupDestination;
  retain: number;
  retainForever: boolean;
  encryption: BackupEncryption;
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

// Whether the first-run setup wizard has been dismissed/completed - see OnboardingGate.
export interface OnboardingSettings {
  dismissed: boolean;
}

export interface AppSettings {
  timeFormat: '12h' | '24h';
  turboWrite: boolean;
  trustProxy: boolean;
  trustProxyAddress: string;
  notifications: NotificationSettings;
  minFreeSpaceGb: number;
  spinDownTimeoutMinutes: number;
  diskLabels: Record<string, string>;
  paritySchedule: ParitySchedule;
  backupSchedule: BackupSchedule;
  tempAlerts: TempAlertSettings;
  lxcStorage: StorageLocation;
  cache: CacheSettings;
  cacheSchedule: CacheSchedule;
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
  // A key mapped to '' removes that disk's label.
  diskLabels: Partial<Record<string, string>>;
  paritySchedule: Partial<ParitySchedule>;
  backupSchedule: Partial<Omit<BackupSchedule, 'encryption'>> & { encryption?: BackupEncryptionInput };
  tempAlerts: Partial<TempAlertSettings>;
  lxcStorage: Partial<StorageLocation>;
  cache: Partial<CacheSettings>;
  cacheSchedule: Partial<CacheSchedule>;
  onboarding: Partial<OnboardingSettings>;
}>;

export interface CommandResult {
  ok: boolean;
  message: string;
}
