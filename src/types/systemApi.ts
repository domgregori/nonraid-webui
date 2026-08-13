// Mirrors backend/src/system/types.ts. Keep in sync.
export interface BootDiskInfo {
  device: string;
  filesystem: string | null;
  usedBytes: number | null;
  totalBytes: number | null;
  model: string | null;
  tempCelsius: number | null;
  uuid: string | null;
}

export interface NetworkInterfaceInfo {
  name: string;
  ipv4: string[];
  ipv6: string[];
  mac: string | null;
}

export interface SystemStats {
  hostname: string;
  timezone: string;
  uptimeSeconds: number;
  cpuPercent: number;
  cpuTempCelsius: number | null;
  memUsedBytes: number;
  memTotalBytes: number;
  buildVersion: string | null;
  version: string;
  bootDisk: BootDiskInfo | null;
  networkInterfaces: NetworkInterfaceInfo[];
}

// null on the first poll of a run (nothing to diff against yet) or a counter reset — see
// backend/src/metrics/net.ts's NetRateTracker.
export interface NetLiveRate {
  rxKbS: number | null;
  txKbS: number | null;
}

export interface RestoreArchiveEntry {
  path: string;
  isSuperblock: boolean;
}

// Mirrors backend/src/system/backupCatalog.ts's BackupCategoryId.
export type BackupCategoryId = 'array' | 'sharing' | 'appConfig' | 'adminAccount' | 'activityHistory' | 'graphHistory';

export interface RestoreCategoryPreview {
  id: BackupCategoryId;
  label: string;
  description: string;
  entries: string[];
}

export interface RestorePreview {
  token: string;
  entries: RestoreArchiveEntry[];
  categories: RestoreCategoryPreview[];
  // Whether the archive's superblock member (if it has one) will actually be restored — only
  // true when this array currently has nothing assigned. See backend/src/system/configRestore.ts.
  arrayIsBlank: boolean;
  arrayStopped: boolean;
}

export interface RestoreCommitResult {
  restoredCount: number;
  skippedSuperblock: boolean;
  /** Set only when the archive's superblock was restored (skippedSuperblock false, the archive
   *  had one) but reloading the driver against it afterward failed — the file itself is in place
   *  either way, this only means the running module hasn't picked it up yet. Null on success or
   *  when there was no superblock to reload for. */
  superblockReloadError: string | null;
  // Whether Docker's daemon.json (storage-location relocation) was part of what was just
  // restored — passed back into restartServices() below so it only bounces Docker (which stops
  // every running container) when a restore actually touched it.
  dockerConfigRestored: boolean;
}

export interface RestartServicesStepResult {
  ok: boolean;
  message: string;
}

// The response the request itself carries — nonraid-webui's own restart happens after this, so
// its outcome is never part of the JSON body (the connection drops instead); the caller confirms
// it separately by polling for the backend coming back.
export interface RestartServicesResult {
  smb: RestartServicesStepResult;
  nfs: RestartServicesStepResult;
  driverReload: RestartServicesStepResult;
  // Null when the caller didn't opt in via restartDocker (see systemApi.restartServices) — Docker
  // stops every running container on restart, so it's never bounced unless daemon.json was
  // actually part of what was just restored.
  docker: RestartServicesStepResult | null;
  message: string;
}
