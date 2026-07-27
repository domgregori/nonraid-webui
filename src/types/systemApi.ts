// Mirrors backend/src/system/types.ts. Keep in sync.
export interface SystemStats {
  hostname: string;
  uptimeSeconds: number;
  cpuPercent: number;
  memUsedBytes: number;
  memTotalBytes: number;
}
