import { RealSmartClient } from './realClient.js';
import type { SmartClient } from './types.js';

export function createSmartClient(): SmartClient {
  return new RealSmartClient();
}

export { SmartService } from './service.js';
export type { SelfTestType, SmartAttributes, SmartClient, SmartHealth } from './types.js';
