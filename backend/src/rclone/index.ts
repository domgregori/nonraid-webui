import type { RcloneClient } from './client.js';
import { RealRcloneClient } from './realClient.js';

export function createRcloneClient(): RcloneClient {
  return new RealRcloneClient();
}

export type { RcloneClient, RcloneCoreStats, RcloneJobStatus } from './client.js';
export * from './types.js';
