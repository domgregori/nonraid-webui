import { HttpError } from '../../httpError.js';
import type { Share, ShareAccess, ShareCommandResult, ShareStats } from '../types.js';
import type { ApplyContext, ShareApplier } from './client.js';

// Deterministic per-share fake usage fraction, so repeated calls are stable
// within a run instead of jittering on every poll.
function usageFraction(name: string): number {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 97;
  return 0.2 + (hash % 60) / 100; // ~20%-80%
}

export class MockShareApplier implements ShareApplier {
  readonly mode = 'mock' as const;
  private mounted = new Set<string>();

  async mountShare(share: Share, ctx: ApplyContext): Promise<ShareCommandResult> {
    const validDisks = share.disks.filter((slot) => ctx.diskMountpoints[slot]);
    if (validDisks.length === 0) {
      throw new HttpError(409, `No mounted disks available for share "${share.name}" — its assigned disks are all offline.`);
    }
    this.mounted.add(share.name);
    return { ok: true, message: `Share "${share.name}" mounted (mock, ${validDisks.length} disk${validDisks.length === 1 ? '' : 's'})` };
  }

  async unmountShare(name: string): Promise<ShareCommandResult> {
    this.mounted.delete(name);
    return { ok: true, message: `Share "${name}" unmounted (mock)` };
  }

  async syncExports(_allShares: Share[], _accessByShare: Record<string, ShareAccess>): Promise<ShareCommandResult> {
    return { ok: true, message: 'Samba/NFS config synced (mock)' };
  }

  async getStats(share: Share, ctx: ApplyContext): Promise<ShareStats> {
    if (!this.mounted.has(share.name)) return { usedBytes: null, totalBytes: null };
    const totalGb = share.disks.reduce((sum, slot) => sum + (ctx.diskSizesGb[slot] ?? 0), 0);
    const totalBytes = totalGb * 1024 * 1024 * 1024;
    return { usedBytes: Math.round(totalBytes * usageFraction(share.name)), totalBytes };
  }
}
