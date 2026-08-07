import type { NmdClient } from './client.js';
import { RealNmdClient } from './realClient.js';

export function createNmdClient(): NmdClient {
  return new RealNmdClient();
}

export type { NmdClient } from './client.js';
export * from './types.js';
