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
