import type { ImportResult, NmdCommandResult, NmdStatusResponse, ParityCheckAction } from './types.js';

export interface NmdClient {
  readonly mode: 'real' | 'mock';
  getStatus(): Promise<NmdStatusResponse>;
  startArray(): Promise<NmdCommandResult>;
  stopArray(): Promise<NmdCommandResult>;
  // Unmounts every array disk's own filesystem (not this app's share mounts
  // — see ShareService.unmountAll, which callers must run first). nmdctl
  // refuses to stop the array in unattended mode while any disk filesystem
  // is still mounted, so routes/array.ts's /array/stop runs both before stopArray().
  unmountDisks(): Promise<NmdCommandResult>;
  // The symmetric case: `nmdctl start` imports/activates the array's md
  // device but never mounts each disk's own filesystem — routes/array.ts's
  // /array/start runs this (then ShareService.remountAll) right after
  // startArray() succeeds, or shares would silently stay unmounted.
  mountDisks(): Promise<NmdCommandResult>;
  // Scans for disks matching the superblock's recorded disk IDs and imports
  // whichever aren't already imported — the same command a fresh Unraid
  // migration needs (see qvr/nonraid's README "Migrating an existing Unraid
  // array"). Safe to call any time the array is stopped, including when
  // everything's already imported (it just reports 0 newly imported).
  importDisks(): Promise<ImportResult>;
  parityCheck(action: ParityCheckAction): Promise<NmdCommandResult>;
  unassignDisk(slot: number): Promise<NmdCommandResult>;
  // The driver has no readback for write method — it's a write-only kernel
  // command (confirmed: absent from both `status -o json` and /proc/nmdstat)
  // — so the caller is the source of truth for what's "currently" set, same
  // as real Unraid's own webGUI does with its persisted disk.cfg tunable.
  setWriteMethod(turbo: boolean): Promise<NmdCommandResult>;
  // Unlike write method, the label *is* read back via getStatus().array.label
  // — nmdctl requires the array to be stopped to change it, and returns a
  // clear error otherwise; that error is surfaced as-is, not special-cased.
  setLabel(label: string): Promise<NmdCommandResult>;
}
