import type { AllocationMethod, ShareWithStats } from '../types/sharesApi';
import { formatBytesHuman } from '../utils/format';

const ALLOCATION_LABELS: Record<AllocationMethod, string> = {
  'most-free': 'Most-free',
  'fill-up': 'Fill-up',
  'high-water': 'High-water',
  'single-disk': 'Single disk',
  'cache-only': 'Cache only',
};

export interface ShareViewModel {
  name: string;
  description: string | null;
  protocolLabel: string;
  allocationLabel: string;
  disksLabel: string;
  usedLabel: string;
  totalLabel: string;
  pct: number;
  connectionsLabel: string;
  accessLabel: string;
}

/** Groups get Samba's own "@groupname" convention, matching how they're already written into
 *  smb.conf's valid/invalid/read lists elsewhere in this app. */
export function deriveAccessLabel(share: Pick<ShareWithStats, 'access' | 'smb' | 'protocols'>): string {
  if (!share.protocols.includes('smb')) return 'Not shared over SMB';
  const principals = [
    ...Object.entries(share.access.users)
      .filter(([, p]) => p === 'read-write' || p === 'read-only')
      .map(([name]) => name),
    ...Object.entries(share.access.groups)
      .filter(([, p]) => p === 'read-write' || p === 'read-only')
      .map(([name]) => `@${name}`),
  ];
  if (principals.length > 0) return principals.join(', ');
  if (share.smb?.public !== false) return 'Public';
  return 'No access configured';
}

export function deriveShareViewModel(share: ShareWithStats): ShareViewModel {
  const { usedBytes, totalBytes } = share.stats;
  const pct = usedBytes !== null && totalBytes ? Math.round((usedBytes / totalBytes) * 100) : 0;

  return {
    name: share.name,
    description: share.description?.trim() || null,
    protocolLabel: share.protocols.length > 0 ? share.protocols.map((p) => p.toUpperCase()).join(', ') : 'Not shared',
    allocationLabel:
      share.allocationMethod === 'single-disk'
        ? `Single disk (Disk ${share.disks[0]})`
        : ALLOCATION_LABELS[share.allocationMethod],
    disksLabel:
      share.allocationMethod === 'cache-only'
        ? 'Cache'
        : share.disks.length === 1
          ? `Disk ${share.disks[0]}`
          : `Disk ${share.disks.join(', ')}`,
    usedLabel: usedBytes !== null ? formatBytesHuman(usedBytes) : '—',
    totalLabel: totalBytes !== null ? formatBytesHuman(totalBytes) : '—',
    pct,
    connectionsLabel: share.activeConnections > 0 ? `${share.activeConnections} connection${share.activeConnections === 1 ? '' : 's'}` : '—',
    accessLabel: deriveAccessLabel(share),
  };
}
