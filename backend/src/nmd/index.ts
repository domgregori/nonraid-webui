import { config } from '../config.js';
import type { NmdClient } from './client.js';
import { MockNmdClient } from './mockClient.js';
import { RealNmdClient } from './realClient.js';

/** No silent switch to mock data. Mock runs only when NMD_MODE=mock is set by hand. */
export function createNmdClient(): NmdClient {
  return config.nmdMode === 'mock' ? new MockNmdClient() : new RealNmdClient();
}

export type { NmdClient } from './client.js';
export * from './types.js';
