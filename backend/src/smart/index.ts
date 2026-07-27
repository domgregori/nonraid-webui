import { config } from '../config.js';
import { MockSmartClient } from './mockClient.js';
import { RealSmartClient } from './realClient.js';
import type { SmartClient } from './types.js';

/** No silent switch to mock data. Mock runs only when SMART_MODE=mock is set by hand. */
export function createSmartClient(): SmartClient {
  return config.smartMode === 'mock' ? new MockSmartClient() : new RealSmartClient();
}

export { SmartService } from './service.js';
export type { SmartClient } from './types.js';
