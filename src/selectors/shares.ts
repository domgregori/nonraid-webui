import type { AllocationMethod, ShareWithStats } from '../types/sharesApi';
import { formatBytesHuman } from '../utils/format';

const ALLOCATION_LABELS: Record<AllocationMethod, string> = {
  'most-free': 'Most-free',
  'fill-up': 'Fill-up',
  'high-water': 'High-water',
  'single-disk': 'Single disk',
};

export interface ShareViewModel {
  name: string;
  protocolLabel: string;
  allocationLabel: string;
  disksLabel: string;
  usedLabel: string;
  totalLabel: string;
  pct: number;
}

export function deriveShareViewModel(share: ShareWithStats): ShareViewModel {
  const { usedBytes, totalBytes } = share.stats;
  const pct = usedBytes !== null && totalBytes ? Math.round((usedBytes / totalBytes) * 100) : 0;

  return {
    name: share.name,
    protocolLabel: share.protocols.map((p) => p.toUpperCase()).join(', '),
    allocationLabel:
      share.allocationMethod === 'single-disk'
        ? `Single disk (Disk ${share.disks[0]})`
        : ALLOCATION_LABELS[share.allocationMethod],
    disksLabel: share.disks.length === 1 ? `Disk ${share.disks[0]}` : `Disk ${share.disks.join(', ')}`,
    usedLabel: usedBytes !== null ? formatBytesHuman(usedBytes) : '—',
    totalLabel: totalBytes !== null ? formatBytesHuman(totalBytes) : '—',
    pct,
  };
}
