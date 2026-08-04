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
  // mergerfs's `minfreespace`, in MB, applied to every pooled share mount
  // (see shares/applier/realApplier.ts). mergerfs excludes any branch below
  // this threshold from create-policy consideration — its own default is
  // 4096 (4G), a sane margin on real multi-TB disks but one that silently
  // makes every branch ineligible (ENOSPC on every write) on small disks.
  minFreeSpaceMb: number;
}

export type AppSettingsUpdate = Partial<{
  turboWrite: boolean;
  notifications: Partial<NotificationSettings>;
  minFreeSpaceMb: number;
}>;
