import type { TailscaleClient } from './client.js';
import { RealTailscaleClient } from './realClient.js';

export function createTailscaleClient(): TailscaleClient {
  return new RealTailscaleClient();
}

export type { TailscaleClient } from './client.js';
export * from './types.js';
