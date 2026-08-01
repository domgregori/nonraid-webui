// Mirrors backend/src/settings/types.ts. Keep in sync.

export interface NotificationSettings {
  enabled: boolean;
  appriseUrls: string;
}

export interface AppSettings {
  turboWrite: boolean;
  notifications: NotificationSettings;
  grafanaUrl: string;
}

export type AppSettingsUpdate = Partial<{
  turboWrite: boolean;
  notifications: Partial<NotificationSettings>;
  grafanaUrl: string;
}>;

export interface CommandResult {
  ok: boolean;
  message: string;
}
