// Mirrors backend/src/settings/types.ts. Keep in sync.

export interface NotificationSettings {
  enabled: boolean;
  appriseUrls: string;
}

export interface AppSettings {
  turboWrite: boolean;
  notifications: NotificationSettings;
  grafanaUrl: string;
  minFreeSpaceMb: number;
}

export type AppSettingsUpdate = Partial<{
  turboWrite: boolean;
  notifications: Partial<NotificationSettings>;
  grafanaUrl: string;
  minFreeSpaceMb: number;
}>;

export interface CommandResult {
  ok: boolean;
  message: string;
}
