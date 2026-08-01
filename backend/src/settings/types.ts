export interface NotificationSettings {
  enabled: boolean;
  // Apprise target URLs (https://github.com/caronc/apprise), space/newline
  // separated — e.g. "mailto://user:pass@gmail.com discord://webhook_id/token".
  // Stored as-is and passed straight through to the apprise CLI; this project
  // doesn't validate or understand individual service URL formats itself.
  appriseUrls: string;
}

export interface AppSettings {
  // Desired state for the array's write method (nmdctl's md_write_method /
  // "turbo write") — see nmd/client.ts's setWriteMethod doc comment for why
  // this has to be persisted here rather than read back from the driver.
  turboWrite: boolean;
  notifications: NotificationSettings;
  // History page's Grafana embed URL — persisted here instead of session-only
  // frontend state so it survives a reload / works from another device.
  grafanaUrl: string;
}

export type AppSettingsUpdate = Partial<{
  turboWrite: boolean;
  notifications: Partial<NotificationSettings>;
  grafanaUrl: string;
}>;
