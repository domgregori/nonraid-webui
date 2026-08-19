import type { LxcClient } from './client.js';
import { RealLxcClient } from './realClient.js';

export function createLxcClient(): LxcClient {
  return new RealLxcClient();
}

export type { LxcClient } from './client.js';
export * from './types.js';
