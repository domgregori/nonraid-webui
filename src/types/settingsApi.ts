// Mirrors backend/src/settings/types.ts. Keep in sync.

export type NotificationEventType =
  | 'diskFailed'
  | 'diskErrors'
  | 'smartFailed'
  | 'parityErrors'
  | 'backupFailed'
  | 'tempAlert'
  | 'diskAdded'
  | 'arrayReconfigured'
  | 'parityStarted'
  | 'parityCompleted'
  | 'backupCompleted'
  | 'arrayStarted'
  | 'arrayStopped';

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

export interface WeeklyOrMonthlySchedule {
  enabled: boolean;
  frequency: 'weekly' | 'monthly';
  dayOfWeek: number; // 0 (Sun) – 6 (Sat), server local time — used when frequency is 'weekly'
  dayOfMonth: number; // 1–28, server local time — used when frequency is 'monthly'
  hour: number; // 0–23, server local time
}

export type ParitySchedule = WeeklyOrMonthlySchedule;

export interface BackupSchedule extends WeeklyOrMonthlySchedule {
  destDir: string;
  retain: number;
}

export interface TempAlertSettings {
  enabled: boolean;
  warnAboveCelsius: number;
}

export interface AppSettings {
  turboWrite: boolean;
  notifications: NotificationSettings;
  minFreeSpaceMb: number;
  paritySchedule: ParitySchedule;
  backupSchedule: BackupSchedule;
  tempAlerts: TempAlertSettings;
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
}>;

export interface CommandResult {
  ok: boolean;
  message: string;
}
