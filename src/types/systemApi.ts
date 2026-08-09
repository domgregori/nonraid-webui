// Mirrors backend/src/system/types.ts. Keep in sync.
export interface BootDiskInfo {
  device: string;
  filesystem: string | null;
  usedBytes: number | null;
  totalBytes: number | null;
  model: string | null;
  tempCelsius: number | null;
}

export interface SystemStats {
  hostname: string;
  uptimeSeconds: number;
  cpuPercent: number;
  cpuTempCelsius: number | null;
  memUsedBytes: number;
  memTotalBytes: number;
  buildVersion: string | null;
  bootDisk: BootDiskInfo | null;
}
