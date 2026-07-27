import type { Share, ShareViewModel } from '../types';

export function deriveShareViewModel(share: Share): ShareViewModel {
  return { ...share, pct: Math.round((share.usedTB / share.sizeTB) * 100) };
}
