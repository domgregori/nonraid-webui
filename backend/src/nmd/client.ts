import type { AddDiskResult, AvailableDevice, ImportResult, NmdCommandResult, NmdStatusResponse, ParityCheckAction } from './types.js';

export interface NmdClient {
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
  // Physical block devices not already claimed by an array slot — for an
  // "Unassigned Devices" list. Read-only, doesn't touch array state.
  listAvailableDevices(): Promise<AvailableDevice[]>;
  // Every currently-visible physical disk, regardless of whether an array
  // slot already claims it — unlike listAvailableDevices(), which
  // deliberately excludes those. Used by the guided import wizard to cross-
  // reference an uploaded superblock's recorded disks against what's
  // actually connected, including disks that are part of whatever array
  // might currently be loaded. Read-only, doesn't touch array state.
  scanAllDisks(): Promise<AvailableDevice[]>;
  // Assigns a device to an *empty* slot only: `add -f slot:device[:id]`,
  // then start the array (naming whatever abnormal state it reports, since
  // unattended mode refuses to start in one otherwise), then kick off the
  // pending clear/reconstruction (`check <action>`, matching /proc/nmdstat's
  // live mdResyncAction) so it starts running in the background. Returns
  // once that's kicked off — doesn't wait for it to finish; the existing
  // getStatus().resync polling already reports its progress, since it's the
  // same field parity checks use. Refuses if the slot already has a disk
  // identity recorded (even one just showing DISK_NP_MISSING) — nmdctl's
  // own `add` treats that as "already assigned" regardless of live status;
  // see replaceDisk() for that case, or restoreUnassignedDisk() if the goal
  // is actually putting the *same* disk back rather than a different one.
  addDisk(slot: number, device: string, diskId?: string): Promise<AddDiskResult>;
  // The occupied-slot counterpart to addDisk(): unassigns the slot and
  // commits that via `start` first (this is the step that clears the old
  // disk's recorded identity and makes the driver stop trusting its
  // on-disk content — correct for a genuine replacement, but irreversible),
  // then runs the same add/start/check sequence addDisk() does for the new
  // device. If the caller actually wants the *same* disk back rather than
  // a different one, don't call this — see restoreUnassignedDisk(), and
  // only while the slot is still showing DISK_NP_MISSING (uncommitted).
  replaceDisk(slot: number, device: string, diskId?: string): Promise<AddDiskResult>;
  // Undoes an *uncommitted* unassign — a slot still showing DISK_NP_MISSING
  // with its disk_id intact, before any `start` has run since the unassign.
  // Re-locates the physical device by its still-recorded disk_id (paths
  // aren't stable across reboots) and re-imports it with matching identity
  // and size, restoring DISK_OK with no clear/rebuild involved. Once a
  // `start` has committed the unassign, the identity is gone and this no
  // longer applies — that's the intentional line between "changed my mind"
  // and "this disk is really gone" (replaceDisk()'s territory instead).
  restoreUnassignedDisk(slot: number): Promise<NmdCommandResult>;
  // `nmdctl mount` never creates a filesystem — a freshly-cleared disk comes
  // out with FS "unknown" and stays unmounted until this runs. Shells out to
  // mkfs.xfs with no -f: XFS refuses on its own if the partition already has
  // a recognized filesystem/RAID signature, the same protection wipefs's
  // absence would otherwise have to be checked for by hand.
  formatDisk(slot: number): Promise<NmdCommandResult>;
  parityCheck(action: ParityCheckAction): Promise<NmdCommandResult>;
  unassignDisk(slot: number): Promise<NmdCommandResult>;
  // Reconfigures the array to drop one or more permanently-disabled slots —
  // the only way this driver supports actually shrinking the topology; see
  // realClient.ts's doc comment for the full sequence and its risk profile.
  // Requires the array already STARTED (to read live device paths) — the
  // caller (routes/array.ts) is responsible for unmounting shares/disks
  // first and remounting them after, same composition as /array/stop and
  // /array/start already use around stopArray()/startArray().
  shrinkArray(dropSlots: number[]): Promise<NmdCommandResult>;
  // Recovers from stale/inconsistent driver-side counters (mdNumMissing,
  // mdNumInvalid, etc. — they accumulate across import calls within a
  // module's lifetime and are never recomputed from scratch except by a
  // fresh module load, e.g. landing in ERROR:TOO_MANY_MISSING_DISKS after
  // one ordinary unassign) without changing anything about the array's
  // actual configuration. Unlike shrinkArray(), the superblock file itself
  // is never touched or replaced — this only reloads the module against the
  // same persisted file and re-imports each slot's already-known identity.
  // Same risk category as shrinkArray()'s module reload; the caller is
  // responsible for the same unmount-before/remount-after composition.
  reloadDriver(): Promise<NmdCommandResult>;
  // Puts an uploaded superblock file (still at its staged temp path) into
  // place and loads it, importing whatever disks match — the guided import
  // wizard's commit step, for bringing in a whole prior Unraid array's
  // worth of disks at once. Unlike reloadDriver(), the file itself really is
  // different, so this is the one case where nmdctl's own disk matching
  // (not just this driver's re-import of already-known identities) decides
  // what comes in. Resolves the real target path itself (the live array's
  // own reported superblock path, falling back to config/nmdctl's default),
  // backs up whatever was already there, and only then copies the staged
  // file in — see realClient.ts for the full sequence and its risk profile
  // (same category as shrinkArray()/reloadDriver()'s module reload). The
  // caller (routes/array.ts) is responsible for the same unmount-before
  // composition those use.
  commitImportedSuperblock(stagedFilePath: string): Promise<{ result: ImportResult; targetPath: string; backedUpTo: string | null }>;
  // The superblock file actually in play right now — same resolution
  // commitImportedSuperblock() uses internally (live status, falling back to
  // config/nmdctl's default), exposed for callers that just need to know the
  // path without committing anything (the boot disk config backup). Read-only.
  getSuperblockPath(): Promise<string>;
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
