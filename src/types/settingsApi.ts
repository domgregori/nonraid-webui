// Mirrors backend/src/settings/types.ts. Keep in sync.

export interface NotificationSettings {
  enabled: boolean;
  appriseUrls: string;
}

export interface ParitySchedule {
  enabled: boolean;
  dayOfWeek: number; // 0 (Sun) – 6 (Sat), server local time
  hour: number; // 0–23, server local time
}

export interface AppSettings {
  turboWrite: boolean;
  notifications: NotificationSettings;
  minFreeSpaceMb: number;
  paritySchedule: ParitySchedule;
}

export type AppSettingsUpdate = Partial<{
  turboWrite: boolean;
  notifications: Partial<NotificationSettings>;
  minFreeSpaceMb: number;
  paritySchedule: Partial<ParitySchedule>;
}>;

export interface CommandResult {
  ok: boolean;
  message: string;
}
