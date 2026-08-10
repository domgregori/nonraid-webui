// Mirrors backend/src/cache/types.ts. Keep in sync.
export type CacheHealth = 'not-configured' | 'healthy' | 'degraded' | 'unavailable';

export interface CacheDeviceStatus {
  devid: number;
  path: string | null;
  model: string | null;
  smartHealth: 'passed' | 'failed' | null;
  missing: boolean;
}

export interface CacheStatus {
  health: CacheHealth;
  enabled: boolean;
  fsUuid: string | null;
  devices: CacheDeviceStatus[];
  usedBytes: number | null;
  totalBytes: number | null;
}

export interface CacheReplaceStatus {
  running: boolean;
  progressPercent: number | null;
  message: string | null;
}

export interface CacheCommandResult {
  ok: boolean;
  message: string;
}
