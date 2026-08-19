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
  /**
   * Fully regenerates the SMB/NFS managed config from the complete current share list
   * plus each share's access list (keyed by share name), then reloads.
   */
  syncExports(allShares: Share[], accessByShare: Record<string, ShareAccess>): Promise<ShareCommandResult>;
  getStats(share: Share, ctx: ApplyContext): Promise<ShareStats>;
  // Live SMB tree-connection count per share name, right now - best-effort, returns {} on any
  // failure (smbstatus missing, smbd not running) rather than throwing. See realApplier.ts.
  getActiveConnectionCounts(): Promise<Record<string, number>>;
}
