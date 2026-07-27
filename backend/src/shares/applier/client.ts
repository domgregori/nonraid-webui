import type { Share, ShareCommandResult, ShareStats } from '../types.js';

export interface ApplyContext {
  diskMountpoints: Record<number, string>; // data disk slot -> real mountpoint, e.g. { 1: '/mnt/disk1' }
  diskSizesGb: Record<number, number>; // data disk slot -> size, for mock stats estimation
}

export interface ShareApplier {
  readonly mode: 'real' | 'mock';
  /** Create or update the pooled mount for this share (idempotent — remounts if it already exists). */
  mountShare(share: Share, ctx: ApplyContext): Promise<ShareCommandResult>;
  unmountShare(name: string): Promise<ShareCommandResult>;
  /** Fully regenerates the SMB/NFS managed config from the complete current share list, then reloads. */
  syncExports(allShares: Share[]): Promise<ShareCommandResult>;
  getStats(share: Share, ctx: ApplyContext): Promise<ShareStats>;
}
