import { config } from '../../config.js';
import { MockShareApplier } from './mockApplier.js';
import { RealShareApplier } from './realApplier.js';
import type { ShareApplier } from './client.js';

/** No silent switch to mock data. Mock runs only when SHARES_MODE=mock is set by hand. */
export function createShareApplier(): ShareApplier {
  return config.sharesMode === 'mock' ? new MockShareApplier() : new RealShareApplier();
}

export type { ApplyContext, ShareApplier } from './client.js';
