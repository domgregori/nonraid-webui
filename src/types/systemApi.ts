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
