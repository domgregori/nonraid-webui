import type { Share, ShareAccess, ShareCommandResult, ShareStats } from '../types.js';

export interface ApplyContext {
  diskMountpoints: Record<number, string>; // data disk slot -> real mountpoint, e.g. { 1: '/mnt/disk1' }
  minFreeSpaceGb: number; // mergerfs's minfreespace, from settings - see settings/types.ts
  // Set only when cache is enabled AND its mirror is confirmed fully mounted (both members present)
  // - never a degraded or unmounted cache, see RealShareApplier.branchPaths()'s doc comment. null
  // means every share pools its array branches only, same as before the cache feature existed.
  cacheMountPoint: string | null;
}

export interface ShareApplier {
  /** Create or update the pooled mount for this share (idempotent - remounts if it already exists). */
  mountShare(share: Share, ctx: ApplyContext): Promise<ShareCommandResult>;
  unmountShare(name: string): Promise<ShareCommandResult>;
  /** Whether this share's mountpoint is currently a live mount (bind or mergerfs) - lets a caller
   *  decide whether mountShare()'s own unconditional unmount-then-remount is actually needed right
   *  now, without having to call it and pay that cost just to find out. See ShareService.remountAll(). */
  isShareMounted(name: string): Promise<boolean>;
  /**
   * Fully regenerates the SMB/NFS managed config from the complete current share list
   * plus each share's access list (keyed by share name), then reloads.
   */
  syncExports(allShares: Share[], accessByShare: Record<string, ShareAccess>): Promise<ShareCommandResult>;
  getStats(share: Share, ctx: ApplyContext): Promise<ShareStats>;
  // Live SMB tree-connections plus, for each NFS-enabled share, however many of its allowed hosts
  // currently have an open connection to the NFS port - per share name, right now. Best-effort,
  // returns {} (or partial results) on any failure rather than throwing. See realApplier.ts.
  getActiveConnectionCounts(shares: Share[]): Promise<Record<string, number>>;
}
