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
  endpoints: string[];
}

/**
 * One connection string per enabled protocol - `smb://host/name` is a real share-name
 * abstraction (see smb.conf's `[name]` section), but NFS has no such thing on its own; the short
 * `nfs://host/name` form only resolves because writeExportsBlock() now exports config.shareMountRoot
 * itself as an NFSv4 pseudo-root (fsid=0,crossmnt) - see its own doc comment for why. Uses
 * window.location.hostname (whatever address the browser is actually connected through right now),
 * same pattern selectors/containers.ts's resolveContainerWebUi() already uses for Docker/LXC links.
 */
export function deriveShareEndpoints(share: Pick<ShareWithStats, 'name' | 'protocols'>): string[] {
  const host = window.location.hostname;
  const endpoints: string[] = [];
  if (share.protocols.includes('smb')) endpoints.push(`smb://${host}/${share.name}`);
  if (share.protocols.includes('nfs')) endpoints.push(`nfs://${host}/${share.name}`);
  return endpoints;
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
  if (share.smb?.public === true) return 'Public';
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
    usedLabel: usedBytes !== null ? formatBytesHuman(usedBytes) : '-',
    totalLabel: totalBytes !== null ? formatBytesHuman(totalBytes) : '-',
    pct,
    connectionsLabel: share.activeConnections > 0 ? `${share.activeConnections} connection${share.activeConnections === 1 ? '' : 's'}` : '-',
    accessLabel: deriveAccessLabel(share),
    endpoints: deriveShareEndpoints(share),
  };
}
