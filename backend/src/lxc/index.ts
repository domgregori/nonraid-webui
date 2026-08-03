import { config } from '../config.js';
import type { LxcClient } from './client.js';
import { MockLxcClient } from './mockClient.js';
import { RealLxcClient } from './realClient.js';

/** No silent switch to mock data. Mock runs only when LXC_MODE=mock is set by hand. */
export function createLxcClient(): LxcClient {
  return config.lxcMode === 'mock' ? new MockLxcClient() : new RealLxcClient();
}

export type { LxcClient } from './client.js';
export * from './types.js';
