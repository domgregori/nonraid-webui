import type { SmartHealth } from '../smart/types.js';

export type CacheHealth = 'not-configured' | 'healthy' | 'degraded' | 'unavailable';

export interface CacheDeviceStatus {
  devid: number;
  path: string | null; // null when this member is currently missing
  model: string | null;
  smartHealth: SmartHealth | null;
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
