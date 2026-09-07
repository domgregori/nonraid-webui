import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ActivityStore } from '../activity/index.js';
import { config } from '../config.js';
import type { DiskQueueService } from '../diskQueue/service.js';
import { HttpError } from '../httpError.js';
import type { LxcClient } from '../lxc/index.js';
import type { NmdClient } from '../nmd/index.js';
import type { NmdDisk, NmdStatusResponse } from '../nmd/types.js';
import type { SettingsStore } from '../settings/store.js';
import type { ShareService } from '../shares/index.js';
import { restoreStoppedContainers, stoppedContainersFromError, unmountMountpointWithContainerRetry, type StoppedContainers } from '../system/arrayLifecycle.js';
import { luksAddKey, luksAddKeyfile, luksClose, luksFormat, luksOpen, luksRemoveKey, type LuksSecret } from './cryptsetup.js';
import { generateRecoveryPassphrase } from './recoveryPassphrase.js';
import type { DiskEncryptionState, FormatAsLuksResult, LuksDiskStatus, LuksStatusResponse } from './types.js';

const execFileAsync = promisify(execFile);

/** Mirrors selectors/disks.ts's frontend derivation exactly - see that file's own comment on why
 *  `filesystem.type` alone ("luks" vs "luks+xfs" vs anything else) is enough, with no extra status
 *  plumbing needed on either side. */
function encryptionStateFor(disk: NmdDisk): DiskEncryptionState {
  const type = disk.filesystem?.type;
  if (!type) return 'none';
  if (type === 'luks') return 'luks-locked';
  if (type.startsWith('luks+')) return 'luks-open';
  return 'none';
}

// Both derived purely from the slot number, matching nmdctl's own convention exactly (confirmed
// against tools/nmdctl's mount_disks() and manual-setup instructions, and against this app's own
// existing formatDisk()): the nmd kernel driver exposes each data slot's partition as
// /dev/nmd<slot>p1, and nmdctl always maps a LUKS device on that path to the same basename
// (nmd<slot>p1) as the mapper name, landing at /dev/mapper/nmd<slot>p1. NmdDisk.device (e.g. "sdd")
// is the *physical* disk underneath - never the right target for cryptsetup, which needs the nmd
// driver's own virtual partition device instead.
function devicePathForSlot(slot: number): string {
  return `/dev/nmd${slot}p1`;
}
function mapNameForSlot(slot: number): string {
  return `nmd${slot}p1`;
}

/**
 * Orchestrates LUKS disk encryption on top of the driver's own already-working open/close/mount
 * mechanism (see docs/luks-support-scope.md) - this class never duplicates that, it only fills the
 * one real gap (guided initial setup) and adds the per-disk lock/unlock and unlock-mode-switch
 * operations the driver has no concept of at all. Every operation here that shells out to
 * cryptsetup goes through luks/cryptsetup.ts, which never puts a passphrase in argv or on disk
 * outside the one deliberate "stored mode" keyfile.
 */
export class LuksService {
  constructor(
    private nmd: NmdClient,
    private shares: ShareService,
    private lxc: LxcClient,
    private activity: ActivityStore,
    private settingsStore: SettingsStore,
    private diskQueue: DiskQueueService,
  ) {}

  private async keyfileExists(): Promise<boolean> {
    try {
      await stat(config.luksKeyfilePath);
      return true;
    } catch {
      return false;
    }
  }

  /** Creates the shared array keyfile if it doesn't already exist - root-owned, 0600, 512 bits of
   *  CSPRNG output. Idempotent: an already-existing keyfile is left untouched (disks already keyed
   *  against it must keep working), never regenerated. */
  private async ensureKeyfile(): Promise<string> {
    if (await this.keyfileExists()) return config.luksKeyfilePath;
    await mkdir(path.dirname(config.luksKeyfilePath), { recursive: true });
    await writeFile(config.luksKeyfilePath, randomBytes(64), { mode: 0o600 });
    await chmod(config.luksKeyfilePath, 0o600); // belt-and-braces against an umask affecting writeFile's own mode
    return config.luksKeyfilePath;
  }

  /**
   * Runs nmdctl's own mount pass, then confirms `slot` specifically ended up mounted - never
   * trusts mountDisks()'s own exit code for that. Confirmed live against the project's own test
   * rig: nmdctl's unattended `mount` exits non-zero whenever it can't mount *every* currently-
   * openable disk in one sweep, not just the one this call actually cares about - unlocking one
   * disk while a *different* disk was still LUKS-locked made a plain `await this.nmd.mountDisks()`
   * reject here, dumping the whole mount pass's stdout as its error message, even though the disk
   * this call unlocked mounted successfully. The same class of "nmdctl's own exit code isn't
   * authoritative" gap nmd/realClient.ts's runStatusJson() already documents and works around for
   * `status -o json`'s exit code - mountDisks() just didn't have an equivalent yet. This matters a
   * lot more once several disks can be unlocked back-to-back in one admin action (see
   * useUnlockAllDisks.ts on the frontend) - every unlock but the last in a batch would otherwise
   * see exactly this false failure, since every other disk in the batch is still locked at that
   * point. A genuine failure to mount *this* slot specifically still surfaces as a clear, specific
   * error rather than being silently swallowed - matching the pre-existing "Disk N still not
   * mounted after mounting disks - try Mount Disk from the Disks page" activity-log warning this
   * app already had for the equivalent gap elsewhere.
   */
  private async mountAndVerifySlot(slot: number): Promise<void> {
    await this.nmd.mountDisks().catch(() => {});
    const status = await this.nmd.getStatus();
    const disk = status.disks.find((d) => d.slot === slot);
    if (!disk || encryptionStateFor(disk) !== 'luks-open') {
      throw new HttpError(502, `Slot ${slot} was unlocked but didn't mount - try Mount Disk from the Disks page.`);
    }
  }

  /** Best-effort, additive-only remount after a lock/unlock/format touches exactly one disk -
   *  deliberately `skipAlreadyMounted: true` (the same gentler mode plain backend startup uses),
   *  not the plain remountAll() every array-wide lifecycle event (start/stop/reload) calls. A
   *  routine single-disk operation shouldn't force an unmount-then-remount of every *other*,
   *  unrelated share too - that tears down live SMB clients on all of them for nothing (see
   *  ShareService.remountAll's own doc comment on why skipAlreadyMounted exists at all, and this
   *  project's own prior incident fixing exactly this class of over-eager remount). This still
   *  picks up two real things: a share not yet mounted for some other reason, and `allDisks: true`
   *  growth onto a disk that just became available for the first time. */
  private async remountGently(): Promise<void> {
    await this.shares.remountAll({ skipAlreadyMounted: true }).catch((err) => {
      this.activity.log(`Shares didn't fully re-check after a LUKS operation: ${(err as Error).message}`, 'amber').catch(() => {});
    });
  }

  async getStatus(): Promise<LuksStatusResponse> {
    const [status, settings, keyfileExists] = await Promise.all([this.nmd.getStatus(), this.settingsStore.get(), this.keyfileExists()]);
    const disks: LuksDiskStatus[] = status.disks
      .filter((d) => d.type !== 'P' && d.type !== 'Q')
      .map((d) => ({
        slot: d.slot,
        encryption: encryptionStateFor(d),
        device: devicePathForSlot(d.slot),
        mapName: mapNameForSlot(d.slot),
      }));
    return { unlockMode: settings.luks.unlockMode, keyfileExists, disks };
  }

  /** Pure lookup over an already-fetched `status` rather than fetching its own - every caller that
   *  also needs other fields off the same status snapshot (formatDiskAsLuks() needs `resync.active`
   *  too) fetches once and passes it in, so the validated `disk` and any sibling check are read
   *  from one consistent moment rather than two separate `getStatus()` calls that could each see a
   *  different live state if something changed in between. */
  private requireDataDisk(status: NmdStatusResponse, slot: number): NmdDisk {
    const disk = status.disks.find((d) => d.slot === slot);
    if (!disk || !disk.disk_id || disk.disk_id === 'none') throw new HttpError(404, `No disk assigned to slot ${slot}.`);
    if (disk.type === 'P' || disk.type === 'Q') {
      // Settled, not a live check worth a nicer message per-driver-version - see
      // docs/luks-support-scope.md's "Parity disk: not supported" section for why this can never
      // change without a much deeper driver change than anything this app controls.
      throw new HttpError(400, 'Parity disks cannot be encrypted - the array driver only opens LUKS at the filesystem-mount step, which parity never goes through.');
    }
    return disk;
  }

  /**
   * Formats a blank data slot as a LUKS2 container with an XFS filesystem on top - the one real
   * gap nmdctl itself leaves unfilled (see docs/luks-support-scope.md). Mirrors
   * NmdClient.formatDisk()'s own pre-checks (no existing filesystem, not currently mounted, no
   * resync in progress) since this replaces that call for the "as LUKS" case rather than running
   * alongside it. Always adds a second, human-memorable recovery-passphrase key slot - see
   * recoveryPassphrase.ts - independent of whichever day-to-day unlock mode is active; if the
   * current unlockMode is 'stored', the shared keyfile is added as a third slot too, so this
   * newly-formatted disk auto-unlocks on the very next array start exactly like the format wizard
   * promised, with no separate "switch to stored" step needed for a disk that was LUKS-formatted
   * while already in stored mode.
   */
  async formatDiskAsLuks(slot: number, passphrase: string): Promise<FormatAsLuksResult> {
    if (typeof passphrase !== 'string' || passphrase.length < 8) {
      throw new HttpError(400, 'Passphrase must be at least 8 characters.');
    }
    // Same guard every other disk-mutating route enforces (POST /disks/:slot/format,
    // /disks/:slot/replace, /disks/:slot/unassign - see routes/disks.ts) before touching a disk's
    // own filesystem - formatDiskAsLuks() is exactly that class of operation (mkfs.xfs, same as a
    // plain format), so it needs the same protection against racing a queued disk-add/parity
    // operation that's also changing array-disk state right now.
    if (this.diskQueue.isBusy()) {
      throw new HttpError(409, 'A queued disk operation is in progress - wait for it to finish.');
    }
    const status = await this.nmd.getStatus();
    const disk = this.requireDataDisk(status, slot);
    if (status.resync.active) {
      throw new HttpError(409, `A clear/sync operation is still running on slot ${slot} - wait for it to finish first.`);
    }
    if (disk.filesystem?.mountpoint && disk.filesystem.mountpoint !== 'unmounted') {
      throw new HttpError(409, `Slot ${slot} is currently mounted at ${disk.filesystem.mountpoint} - unmount it (or unassign the disk) before formatting.`);
    }
    if (disk.filesystem?.type && disk.filesystem.type !== 'unknown') {
      throw new HttpError(409, `Slot ${slot} already has a filesystem (${disk.filesystem.type}) - refusing to reformat over existing data.`);
    }

    const device = devicePathForSlot(slot);
    const mapName = mapNameForSlot(slot);
    const recoveryPassphrase = generateRecoveryPassphrase();
    const settings = await this.settingsStore.get();

    await luksFormat(device, passphrase);
    try {
      await luksOpen(device, mapName, { passphrase });
      try {
        await luksAddKey(device, { passphrase }, recoveryPassphrase);
        if (settings.luks.unlockMode === 'stored') {
          const keyfilePath = await this.ensureKeyfile();
          await luksAddKeyfile(device, passphrase, keyfilePath);
        }
        await execFileAsync('mkfs.xfs', [`/dev/mapper/${mapName}`], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
      } catch (err) {
        // Only close on a genuine failure - the success path deliberately leaves the mapping open,
        // see the comment on the mountDisks() call below for why.
        await luksClose(mapName).catch(() => {});
        throw err;
      }
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      throw new HttpError(502, `LUKS setup failed on slot ${slot}: ${e.stderr?.trim() || e.stdout?.trim() || e.message}`);
    }

    // Deliberately left open (not luksClose()'d) from the successful path above: nmdctl's own
    // mount pass re-derives each disk's fs_type fresh (get_fs_type()) and only tries the keyfile
    // at all when a device's LUKS mapping isn't already active - closing here first would force
    // nmdctl to re-open it itself, which fails whenever the shared keyfile file already exists on
    // disk (e.g. from an earlier, unrelated encrypted disk) but wasn't added to this one (manual
    // mode - or a 'stored'-mode format where ensureKeyfile()/luksAddKeyfile() above somehow didn't
    // take). Confirmed live against the project's own test rig: formatting a disk while manual
    // mode was active, with a keyfile already present from an earlier, unrelated disk, failed here
    // with "No key available with this passphrase" despite the format itself having fully
    // succeeded, until this was fixed to leave the mapping open. Leaving it open means nmdctl sees
    // an already-open "luks+xfs" filesystem and just mounts it directly, the same as any other
    // already-open LUKS disk it encounters.
    await this.mountAndVerifySlot(slot);
    await this.remountGently();
    this.activity.log(`Disk ${slot} formatted as an encrypted (LUKS) XFS volume`, 'blue').catch(() => {});

    return { slot, message: `Slot ${slot} formatted as LUKS and mounted.`, recoveryPassphrase };
  }

  /**
   * Locks one already-unlocked LUKS data disk - unmounts its filesystem and runs `cryptsetup
   * luksClose`, leaving every *other* disk (and every share not solely dependent on this one)
   * untouched. `nmdctl unmount` has no per-disk form (it's all-active-data-disks-at-once), so this
   * calls `umount` directly, with the same Docker/LXC busy-mountpoint retry the array-wide unmount
   * already needed - confirmed live against the project's own test rig that a real Docker daemon
   * rooted on an array disk holds its mountpoint busy exactly like this.
   */
  async lockDisk(slot: number): Promise<void> {
    const disk = this.requireDataDisk(await this.nmd.getStatus(), slot);
    if (encryptionStateFor(disk) !== 'luks-open') {
      throw new HttpError(409, `Slot ${slot} isn't an unlocked LUKS disk.`);
    }
    const mountpoint = disk.filesystem?.mountpoint;
    if (!mountpoint || !mountpoint.startsWith('/')) {
      throw new HttpError(409, `Slot ${slot} has no live mountpoint to lock.`);
    }
    const mapName = mapNameForSlot(slot);

    let stopped: StoppedContainers = { dockerStopped: false, stoppedLxcNames: [] };
    try {
      stopped = await unmountMountpointWithContainerRetry({ shares: this.shares, lxc: this.lxc, activity: this.activity }, mountpoint, true);
    } catch (err) {
      stopped = stoppedContainersFromError(err, stopped);
      await restoreStoppedContainers(this.lxc, stopped);
      await this.remountGently();
      throw new HttpError(502, `Could not unmount slot ${slot} to lock it: ${(err as Error).message}`);
    }

    try {
      await luksClose(mapName);
    } catch (err) {
      // Unmounted but couldn't close the mapping - remount so the disk isn't left needlessly
      // inaccessible over a lock that didn't actually take.
      await this.nmd.mountDisks().catch(() => {});
      await restoreStoppedContainers(this.lxc, stopped);
      await this.remountGently();
      throw new HttpError(502, `Unmounted slot ${slot} but failed to close its LUKS mapping: ${(err as Error).message}`);
    }

    await restoreStoppedContainers(this.lxc, stopped);
    // unmountMountpointWithContainerRetry() above just unmounted *every* share (not only ones
    // touching this slot - see its own doc comment on why), so every other, unrelated share needs
    // bringing back here, same as a successful format/unlock already does via remountGently(). The
    // share(s) that were solely backed by this now-locked disk simply have zero live branches to
    // remount with - buildContext() already excludes a disk with no live mountpoint from every
    // share the same way it would for any other unmounted disk - so remountAll()'s own per-share
    // try/catch logs that as a (correct, expected) failure rather than blocking every other share.
    await this.remountGently();
    this.activity.log(`Disk ${slot} locked`, 'amber').catch(() => {});
  }

  /**
   * Unlocks one locked LUKS data disk and mounts it - via a supplied passphrase (manual mode, or
   * the recovery passphrase), an ad-hoc keyfile's raw bytes uploaded for this one call
   * (`keyfileContents` - never written to disk, piped straight to cryptsetup's own stdin exactly
   * like a passphrase already is, see cryptsetup.ts's luksOpen()), or the shared stored keyfile
   * when neither is given (stored mode). Runs `nmdctl mount` afterward exactly like
   * formatDiskAsLuks() does: nmdctl's own mount pass skips any disk that's already mounted and
   * only actually touches the one this just opened.
   */
  async unlockDisk(slot: number, passphrase?: string, keyfileContents?: Buffer): Promise<void> {
    const disk = this.requireDataDisk(await this.nmd.getStatus(), slot);
    if (encryptionStateFor(disk) !== 'luks-locked') {
      throw new HttpError(409, `Slot ${slot} isn't a locked LUKS disk.`);
    }
    const device = devicePathForSlot(slot);
    const mapName = mapNameForSlot(slot);
    let secret: LuksSecret;
    if (keyfileContents && keyfileContents.length > 0) {
      secret = { keyfileContents };
    } else if (typeof passphrase === 'string' && passphrase.length > 0) {
      secret = { passphrase };
    } else {
      if (!(await this.keyfileExists())) {
        throw new HttpError(400, 'No passphrase or keyfile given and no stored keyfile is available - enter the passphrase or upload a keyfile to unlock this disk.');
      }
      secret = { keyfilePath: config.luksKeyfilePath };
    }

    try {
      await luksOpen(device, mapName, secret);
    } catch (err) {
      throw new HttpError(400, `Could not unlock slot ${slot}: ${(err as Error).message}`);
    }

    await this.mountAndVerifySlot(slot);
    await this.remountGently();
    this.activity.log(`Disk ${slot} unlocked`, 'blue').catch(() => {});
  }

  /**
   * Switches every currently-unlocked encrypted data disk to the 'stored' (auto-unlock) mode -
   * adds the shared keyfile as a new key slot on each, authorized by `passphrase`. A locked disk
   * can't be re-keyed without first being unlocked (cryptsetup has no way to add a slot to a
   * container it can't already open), so this only ever touches disks that are currently open;
   * the caller's own UI is expected to have the admin unlock everything first (see
   * docs/luks-support-scope.md's "Switching modes is a real operation" section).
   *
   * Any encrypted disk that's locked at the moment this runs is silently outside `openDisks`
   * entirely - not a re-key failure, so it never lands in `failures` below, yet `unlockMode`
   * still flips to 'stored' for the whole array. Since that setting is a claim (see
   * settings/types.ts's own doc comment) that the keyfile is a valid key slot on *every*
   * encrypted disk, leaving that disk uncounted would make the claim silently false - surfaced
   * here as its own warning, separate from the per-disk failures loop, so a locked disk skipped
   * this way is never indistinguishable from one that was actually keyed.
   */
  async switchToStored(passphrase: string): Promise<{ disksUpdated: number; skippedLocked: number }> {
    if (typeof passphrase !== 'string' || passphrase.length === 0) {
      throw new HttpError(400, 'passphrase is required.');
    }
    const status = await this.nmd.getStatus();
    const openDisks = status.disks.filter((d) => encryptionStateFor(d) === 'luks-open');
    const skippedLocked = status.disks.filter((d) => encryptionStateFor(d) === 'luks-locked').length;
    if (openDisks.length === 0) {
      throw new HttpError(409, 'No unlocked encrypted disks found - unlock every encrypted disk first.');
    }

    const keyfilePath = await this.ensureKeyfile();
    let updated = 0;
    const failures: string[] = [];
    for (const d of openDisks) {
      try {
        await luksAddKeyfile(devicePathForSlot(d.slot), passphrase, keyfilePath);
        updated++;
      } catch (err) {
        failures.push(`slot ${d.slot}: ${(err as Error).message}`);
      }
    }
    if (updated === 0) {
      throw new HttpError(400, `Could not add the keyfile to any disk - check the passphrase (${failures.join('; ')}).`);
    }

    await this.settingsStore.update({ luks: { unlockMode: 'stored' } });
    this.activity.log(`Switched to stored (auto-unlock) mode for ${updated} encrypted disk(s)`, 'blue').catch(() => {});
    if (failures.length > 0) {
      this.activity
        .log(`Stored-mode switch: could not add the keyfile to ${failures.length} disk(s) - ${failures.join('; ')}`, 'amber')
        .catch(() => {});
    }
    if (skippedLocked > 0) {
      this.activity
        .log(`Stored-mode switch: ${skippedLocked} locked disk(s) were skipped and still need a passphrase to unlock - unlock and switch them individually`, 'amber')
        .catch(() => {});
    }
    return { disksUpdated: updated, skippedLocked };
  }

  /**
   * The reverse of switchToStored(): adds `newPassphrase` as a fresh key slot (authorized by the
   * keyfile itself, so this doesn't need the admin to already know an existing passphrase),
   * removes the keyfile's own key slot, then deletes the keyfile file - after this, no secret
   * capable of unlocking any array disk is stored anywhere on the machine.
   *
   * A locked disk is invisible to `openDisks` the same way it is in switchToStored() above - it's
   * never re-keyed, and the keyfile gets deleted anyway. That's not the data-loss risk it might
   * look like: every LUKS disk in this app always keeps its original format-time passphrase and
   * its mandatory recovery passphrase regardless of unlock mode (see formatDiskAsLuks() - the
   * keyfile is only ever an *additive* third slot, never the only one), so a locked disk skipped
   * here simply keeps needing one of those two already-existing secrets, same as before this
   * call. It does mean that disk is left carrying an orphaned, now-unusable keyfile-derived slot
   * once it's next unlocked and its own copy of the deleted keyfile bytes can't match anything -
   * worth its own warning, separate from the per-disk failures loop, rather than being silently
   * indistinguishable from a disk that was actually re-keyed.
   */
  async switchToManual(newPassphrase: string): Promise<{ disksUpdated: number; skippedLocked: number }> {
    if (typeof newPassphrase !== 'string' || newPassphrase.length < 8) {
      throw new HttpError(400, 'Passphrase must be at least 8 characters.');
    }
    if (!(await this.keyfileExists())) {
      throw new HttpError(409, 'No stored keyfile is active - already in manual mode.');
    }
    const status = await this.nmd.getStatus();
    const openDisks = status.disks.filter((d) => encryptionStateFor(d) === 'luks-open');
    const skippedLocked = status.disks.filter((d) => encryptionStateFor(d) === 'luks-locked').length;

    let updated = 0;
    const failures: string[] = [];
    for (const d of openDisks) {
      const device = devicePathForSlot(d.slot);
      try {
        await luksAddKey(device, { keyfilePath: config.luksKeyfilePath }, newPassphrase);
        await luksRemoveKey(device, { keyfilePath: config.luksKeyfilePath });
        updated++;
      } catch (err) {
        failures.push(`slot ${d.slot}: ${(err as Error).message}`);
      }
    }

    await this.settingsStore.update({ luks: { unlockMode: 'manual' } });
    // Deleting the keyfile is unconditional even if a disk above failed to drop its own reference
    // to it - a disk that failed above still has a valid (if orphaned) key slot derived from the
    // keyfile's old bytes, which is loudly surfaced below rather than left to look like a clean
    // success; re-running this switch (or a manual luksRemoveKey) is the recovery path for that
    // disk, not silently keeping the keyfile file around "just in case".
    await unlink(config.luksKeyfilePath).catch(() => {});

    this.activity.log(`Switched to manual unlock mode for ${updated} encrypted disk(s) - the keyfile has been removed`, 'amber').catch(() => {});
    if (failures.length > 0) {
      this.activity
        .log(`Manual-mode switch: ${failures.length} disk(s) may still carry a now-orphaned keyfile-derived key slot - ${failures.join('; ')}`, 'red')
        .catch(() => {});
    }
    if (skippedLocked > 0) {
      this.activity
        .log(
          `Manual-mode switch: ${skippedLocked} locked disk(s) were skipped and will carry an orphaned keyfile-derived key slot once unlocked - their original or recovery passphrase still works`,
          'amber',
        )
        .catch(() => {});
    }
    return { disksUpdated: updated, skippedLocked };
  }
}
