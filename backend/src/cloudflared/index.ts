import type { CloudflaredClient } from './client.js';
import { RealCloudflaredClient } from './realClient.js';

export function createCloudflaredClient(): CloudflaredClient {
  return new RealCloudflaredClient();
}

export type { CloudflaredClient } from './client.js';
export * from './types.js';
export { hasCloudflaredToken, setCloudflaredToken } from './tokenStore.js';
