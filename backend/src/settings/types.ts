export interface NotificationSettings {
  enabled: boolean;
  // Apprise target URLs (https://github.com/caronc/apprise), space/newline
  // separated — e.g. "mailto://user:pass@gmail.com discord://webhook_id/token".
  // Stored as-is and passed straight through to the apprise CLI; this project
  // doesn't validate or understand individual service URL formats itself.
  appriseUrls: string;
}

export interface WeeklyOrMonthlySchedule {
  enabled: boolean;
  frequency: 'weekly' | 'monthly';
  dayOfWeek: number; // 0 (Sun) – 6 (Sat), server local time — used when frequency is 'weekly'
  // 1–28 rather than 1–31: every month has at least 28 days, so this sidesteps
  // "the 30th doesn't exist in February" without needing month-length logic.
  dayOfMonth: number; // 1–28, server local time — used when frequency is 'monthly'
  hour: number; // 0–23, server local time
}

export type ParitySchedule = WeeklyOrMonthlySchedule;

export interface BackupSchedule extends WeeklyOrMonthlySchedule {
  destDir: string; // absolute path to write backups into — should be on the array, not the boot disk
  retain: number; // how many past backups to keep; older ones are pruned after each successful run
}

export interface TempAlertSettings {
  enabled: boolean;
  // Single shared threshold for both CPU package temp and disk SMART temps —
  // simpler than per-device tuning, and this project has no per-device UI
  // for it elsewhere either.
  warnAboveCelsius: number;
}

export interface AppSettings {
  // Desired state for the array's write method (nmdctl's md_write_method /
  // "turbo write") — see nmd/client.ts's setWriteMethod doc comment for why
  // this has to be persisted here rather than read back from the driver.
  turboWrite: boolean;
  notifications: NotificationSettings;
  // mergerfs's `minfreespace`, in MB, applied to every pooled share mount
  // (see shares/applier/realApplier.ts). mergerfs excludes any branch below
  // this threshold from create-policy consideration — its own default is
  // 4096 (4G), a sane margin on real multi-TB disks but one that silently
  // makes every branch ineligible (ENOSPC on every write) on small disks.
  minFreeSpaceMb: number;
  paritySchedule: ParitySchedule;
  backupSchedule: BackupSchedule;
  tempAlerts: TempAlertSettings;
}

export type AppSettingsUpdate = Partial<{
  turboWrite: boolean;
  notifications: Partial<NotificationSettings>;
  minFreeSpaceMb: number;
  paritySchedule: Partial<ParitySchedule>;
  backupSchedule: Partial<BackupSchedule>;
  tempAlerts: Partial<TempAlertSettings>;
}>;
