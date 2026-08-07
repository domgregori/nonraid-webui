import { RealShareApplier } from './realApplier.js';
import type { ShareApplier } from './client.js';

export function createShareApplier(): ShareApplier {
  return new RealShareApplier();
}

export type { ApplyContext, ShareApplier } from './client.js';
