import { execFile, spawn } from 'node:child_process';
import { closeSync, constants, openSync } from 'node:fs';
import { readFile, rmdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { getDiskType } from '../system/diskType.js';
import type { NmdClient } from './client.js';
import { ArrayNotConfiguredError, type AddDiskResult, type AvailableDevice, type ImportResult, type NmdCommandResult, type NmdStatusResponse, type ParityCheckAction } from './types.js';

const execFileAsync = promisify(execFile);

// Matches DEFAULT_SUPERBLOCK in tools/nmdctl (the main nonraid repo) exactly
// — the path nmdctl itself falls back to when neither -s/--super nor
// SUPERBLOCK_PATH is given.
const DEFAULT_SUPERBLOCK_PATH = '/nonraid.dat';

/**
 * Deterministic fallback ID for a device with no real udev-visible serial
 * (common for virtio test disks, and any real disk without `serial=` set).
 * Shared so findDeviceByDiskId() can reverse it — a synthetic ID isn't
 * something a fresh udevadm scan will ever reproduce, so relocating one
 * needs to check each candidate's own path against this same formula
 * instead of the normal diskId comparison.
 */
function syntheticDiskId(devicePath: string): string {
  return `manual-${devicePath.replace(/[^a-zA-Z0-9]+/g, '-')}`;
}

/**
 * Parses `nmdctl -u --no-color import`'s stdout. The command itself always
 * exits 0 even when some disks were skipped (a size mismatch, a missing
 * physical disk, etc.) — see import_disks() in tools/nmdctl, the main
 * nonraid repo — so the only way to detect those conditions is text parsing,
 * not the exit code.
 */
function parseImportOutput(output: string): ImportResult {
  const lines = output.split('\n');
  const mismatchSizes = new Map<number, { partitionSizeKb: number | null; expectedSizeKb: number | null }>();
  const skippedSlots = new Set<number>();
  const errors: string[] = [];
  let importedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();

    const sizeWarning = line.match(/^Warning: Size mismatch for disk in slot (\d+)$/);
    if (sizeWarning) {
      const slot = Number(sizeWarning[1]);
      const partitionSizeKb = Number(lines[i + 1]?.match(/Partition size: (\d+) KB/)?.[1]);
      const expectedSizeKb = Number(lines[i + 2]?.match(/Expected size\s*: (\d+) KB/)?.[1]);
      mismatchSizes.set(slot, {
        partitionSizeKb: Number.isFinite(partitionSizeKb) ? partitionSizeKb : null,
        expectedSizeKb: Number.isFinite(expectedSizeKb) ? expectedSizeKb : null,
      });
      continue;
    }

    const skipped = line.match(/^Error: Size mismatch for disk in slot (\d+) \(unattended mode\)$/);
    if (skipped) {
      skippedSlots.add(Number(skipped[1]));
      continue;
    }

    const successCount = line.match(/^Successfully imported (\d+) disk\(s\)$/);
    if (successCount) {
      importedCount = Number(successCount[1]);
      continue;
    }

    if (line.startsWith('Error:')) errors.push(line);
  }

  const sizeMismatches = [...skippedSlots].map((slot) => ({
    slot,
    partitionSizeKb: mismatchSizes.get(slot)?.partitionSizeKb ?? null,
    expectedSizeKb: mismatchSizes.get(slot)?.expectedSizeKb ?? null,
  }));

  return { importedCount, sizeMismatches, errors, output };
}

/**
 * Shells out to the real nmdctl binary. Always passes -u (unattended) so
 * confirmation prompts that expect an interactive TTY don't hang the process,
 * and --no-color so output stays parseable.
 */
export class RealNmdClient implements NmdClient {

  private nmdArgs(args: string[]): { bin: string; fullArgs: string[] } {
    const baseArgs = ['-u', '--no-color'];
    if (config.nmdSuperblock) baseArgs.push('-s', config.nmdSuperblock);
    const bin = config.nmdUseSudo ? 'sudo' : config.nmdBin;
    const fullArgs = config.nmdUseSudo ? [config.nmdBin, ...baseArgs, ...args] : [...baseArgs, ...args];
    return { bin, fullArgs };
  }

  private async run(args: string[]): Promise<{ stdout: string; stderr: string }> {
    const { bin, fullArgs } = this.nmdArgs(args);
    try {
      return await execFileAsync(bin, fullArgs, { timeout: config.nmdTimeoutMs, maxBuffer: 8 * 1024 * 1024 });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      throw new Error(e.stderr?.trim() || e.stdout?.trim() || e.message);
    }
  }

  /**
   * `status -o json`'s exit code mirrors the array's own health code (see
   * ARRAY_STATUS_DATA/health logic in tools/nmdctl) — nonzero means "not
   * fully healthy" (stopped, degraded, new, ...), not "the command failed".
   * The JSON on stdout is still complete either way, so this tries to parse
   * it before falling back to run()'s normal throw-on-nonzero-exit behavior,
   * unlike every other command here where a nonzero exit really is a failure.
   */
  private async runStatusJson(args: string[]): Promise<string> {
    const { bin, fullArgs } = this.nmdArgs(args);
    try {
      return (await execFileAsync(bin, fullArgs, { timeout: config.nmdTimeoutMs, maxBuffer: 8 * 1024 * 1024 })).stdout;
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      if (e.stdout) {
        try {
          JSON.parse(e.stdout);
          return e.stdout;
        } catch {
          // stdout wasn't valid JSON either — a real failure, fall through to throw below
        }
      }
      throw new Error(e.stderr?.trim() || e.stdout?.trim() || e.message);
    }
  }

  /** Writes one command to /proc/nmdcmd — the driver interface nmdctl itself uses internally. */
  private async writeNmdCmd(cmd: string): Promise<void> {
    if (!config.nmdUseSudo) {
      await writeFile(config.nmdCmdPath, cmd);
      return;
    }

    // Async execFile has no `input` option (that's execFileSync-only) — use spawn
    // and write to stdin directly. `tee` takes the command on stdin, so there's no
    // shell string here for anything to (mis)interpret.
    await new Promise<void>((resolve, reject) => {
      const child = spawn('sudo', ['tee', config.nmdCmdPath], { timeout: config.nmdTimeoutMs });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `Failed to write to ${config.nmdCmdPath} (exit ${code})`));
      });
      child.stdin.write(cmd);
      child.stdin.end();
    });
  }

  /** For `mv`/`modprobe` — not nmdctl itself, but same sudo convention as everything else here. */
  private async runSystem(bin: string, args: string[], timeoutMs = 30_000): Promise<{ stdout: string; stderr: string }> {
    const useSudo = config.nmdUseSudo;
    try {
      return await execFileAsync(useSudo ? 'sudo' : bin, useSudo ? [bin, ...args] : args, { timeout: timeoutMs });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      throw new Error(e.stderr?.trim() || e.stdout?.trim() || e.message);
    }
  }

  /**
   * Reconfigures the array to drop one or more permanently-disabled slots —
   * the only way this driver supports actually shrinking the topology
   * (confirmed against tools/nmdctl this session: `create` only ever adds
   * slot coverage, never removes it, so an already-disabled slot stays
   * visible/counted forever otherwise). This mirrors, command-for-command,
   * the manual recovery sequence used (and verified safe for real disk data)
   * multiple times this session: move the superblock aside — never delete —
   * reload the kernel module fresh, then `create -f` naming only the disks
   * being kept, using each one's own currently-live device+id so nothing
   * about *their* content is touched, only the array's own metadata.
   *
   * The module reload is the one genuinely risky step in this whole
   * codebase: unlike everything else here, a failure between the two
   * modprobe calls leaves the array kernel-side down with no automatic way
   * back — see the thrown error for the exact manual recovery command in
   * that case, the same one used tonight.
   */
  async shrinkArray(dropSlots: number[]): Promise<NmdCommandResult> {
    const status = await this.getStatus();
    if (status.array.state !== 'STARTED') {
      throw new Error('Array must be started (so live device paths can be read) before shrinking it.');
    }
    if (dropSlots.length === 0) throw new Error('No slots given to drop.');

    for (const slot of dropSlots) {
      const d = status.disks.find((x) => x.slot === slot);
      if (d && d.status === 'DISK_OK') {
        throw new Error(`Slot ${slot} has an active disk (${d.device}) — unassign and commit that first.`);
      }
    }

    const keep = status.disks.filter((d) => d.status === 'DISK_OK' && !dropSlots.includes(d.slot));
    if (keep.length === 0) throw new Error('Refusing to reconfigure to zero disks.');
    for (const d of keep) {
      if (!d.device || d.device === 'none' || !d.disk_id || d.disk_id === 'none') {
        throw new Error(`Could not read a live device/id for slot ${d.slot} — refusing to proceed.`);
      }
    }

    const superblockPath = status.array.superblock;
    const backupPath = `${superblockPath}.bak-shrink-${Date.now()}`;

    await this.run(['stop']);
    await this.runSystem('mv', [superblockPath, backupPath]);

    try {
      await this.runSystem('modprobe', ['-r', 'nonraid']);
    } catch (err) {
      // Module still loaded (or in an unknown state) but the old superblock is
      // safely backed up, not gone — restore the filename and surface the error
      // as-is; nothing kernel-side has changed yet at this point.
      await this.runSystem('mv', [backupPath, superblockPath]).catch(() => {});
      throw err;
    }

    try {
      await this.runSystem('modprobe', ['nonraid', `super=${superblockPath}`]);
    } catch (err) {
      // Worst case: module unloaded and the reload itself failed — the array is
      // down with no automatic way back. This exact command is what fixed the
      // same situation manually tonight.
      throw new Error(
        `Module reload failed after unloading — the array is currently down. ` +
          `Run manually: sudo modprobe nonraid super=${superblockPath} (original superblock backed up at ${backupPath}). ` +
          `Underlying error: ${(err as Error).message}`,
      );
    }

    const params = keep
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((d) => `${d.slot}:/dev/${d.device}:${d.disk_id}`);
    await this.run(['create', '-f', ...params]);

    await this.startArray();
    const afterStart = await this.getStatus();
    // See commitNewDisk()'s comment: resync.action holds a stale idle label
    // even when nothing is pending — `pending` is the real signal.
    if (afterStart.resync.pending) {
      const pendingAction = afterStart.resync.action.trim().split(/\s+/)[0]!;
      await this.run(['check', pendingAction]);
    }

    // nmdctl's own mount command creates /mnt/diskN on demand but never
    // removes it — a dropped slot would otherwise leave an empty, orphaned
    // mount point behind forever. Best-effort and deliberately the plain
    // (non-recursive) rmdir: it only succeeds on a genuinely empty
    // directory, so anything unexpectedly left there (or still mounted —
    // rmdir also refuses on an active mount point) is left alone rather
    // than risking deleting something real.
    for (const slot of dropSlots) {
      await rmdir(`/mnt/disk${slot}`).catch(() => {});
    }

    return { ok: true, message: `Array reconfigured to ${keep.length} disks (backup of old superblock at ${backupPath}); parity rebuild started.` };
  }

  /**
   * Recovers from stale/inconsistent driver-side counters (mdNumMissing,
   * mdNumInvalid, etc.) without changing anything about the array's actual
   * configuration — the superblock file is never touched or replaced, only
   * the live kernel state gets refreshed by reloading against the same
   * persisted file and re-importing each slot's already-known identity.
   * This is the exact manual recovery sequence used successfully multiple
   * times this session for ERROR:TOO_MANY_MISSING_DISKS and similar states
   * that don't reflect any real problem with the disks themselves.
   *
   * Deliberately does not require the array to be STARTED first — unlike
   * shrinkArray(), this is meant to work *from* an abnormal ERROR:* state,
   * where array.state itself isn't 'STARTED'. Each disk's identity comes
   * from status.disks[].disk_id, which stays populated even for a slot
   * currently showing DISABLED/MISSING because of the very counter
   * staleness this recovers from (confirmed repeatedly this session) — but
   * status.disks[].device reads "none" for exactly those slots, so the
   * actual device path is re-located fresh via disk_id, the same approach
   * restoreUnassignedDisk() uses.
   */
  async reloadDriver(): Promise<NmdCommandResult> {
    const before = await this.getStatus();
    const superblockPath = before.array.superblock;

    const known = before.disks.filter((d) => d.disk_id && d.disk_id !== 'none');
    if (known.length === 0) {
      throw new Error('No disks with a known identity to re-import — nothing to safely recover.');
    }

    const located: { slot: number; device: string; diskId: string; sizeKb: number }[] = [];
    for (const d of known) {
      const found = await this.findDeviceByDiskId(d.disk_id);
      if (!found) {
        throw new Error(
          `Could not find a physical device matching slot ${d.slot}'s recorded ID (${d.disk_id}) — refusing to proceed with an incomplete re-import.`,
        );
      }
      located.push({ slot: d.slot, device: found.partition ?? found.device, diskId: d.disk_id, sizeKb: d.size_kb });
    }

    await this.run(['stop']);

    try {
      await this.runSystem('modprobe', ['-r', 'nonraid']);
    } catch (err) {
      throw new Error(`Module unload failed — nothing was touched, array state is unchanged. Underlying error: ${(err as Error).message}`);
    }

    try {
      await this.runSystem('modprobe', ['nonraid', `super=${superblockPath}`]);
    } catch (err) {
      throw new Error(
        `Module reload failed after unloading — the array is currently down. ` +
          `Run manually: sudo modprobe nonraid super=${superblockPath}. ` +
          `Underlying error: ${(err as Error).message}`,
      );
    }

    for (const d of located) {
      await this.writeNmdCmd(`import ${d.slot} ${basename(d.device)} 0 ${d.sizeKb} 0 ${d.diskId}`);
    }

    await this.startArray();
    return {
      ok: true,
      message: `Driver reloaded and ${located.length} disk(s) re-imported with their existing identities — the array's configuration didn't change.`,
    };
  }

  /**
   * Puts an uploaded superblock file into place and loads it, importing
   * whatever disks match — the guided import wizard's commit step. Mirrors
   * reloadDriver()'s already-proven stop/unload/reload structure exactly,
   * the only differences being *which* file gets loaded (backed up first,
   * same as shrinkArray()) and that the disk matching is a fresh `import`
   * (nmdctl's own scan) rather than re-importing previously-known
   * identities. All filesystem touches go through runSystem (not plain
   * Node fs) for the same reason every other privileged operation here
   * does: this process may not itself have permission on the real
   * superblock path, only sudo does (see nmdUseSudo).
   *
   * The caller (routes/array.ts) is responsible for the same unmount-before
   * composition reloadDriver()'s callers use.
   */
  /**
   * The superblock file actually in play right now: the live path
   * (`status.array.superblock`) when something's loaded, else this app's own
   * configured override, else nmdctl's own hardcoded default. `getStatus()`
   * can throw on a genuinely fresh host — see check_module_loaded() in
   * tools/nmdctl — so that's the fallback trigger, not a real error here.
   */
  async getSuperblockPath(): Promise<string> {
    try {
      return (await this.getStatus()).array.superblock;
    } catch {
      return config.nmdSuperblock || DEFAULT_SUPERBLOCK_PATH;
    }
  }

  // Shared by commitImportedSuperblock() and reloadModuleAndImport(): stop, unload, reload
  // against targetPath, then scan-import whatever the driver finds there. backedUpTo is only for
  // the error messages below (commitImportedSuperblock's own backup — reloadModuleAndImport has
  // none, its caller already placed the file directly).
  private async stopUnloadReloadImport(targetPath: string, backedUpTo: string | null): Promise<ImportResult> {
    await this.run(['stop']);

    try {
      await this.runSystem('modprobe', ['-r', 'nonraid']);
    } catch (err) {
      throw new Error(
        `Module unload failed — the new superblock is in place at ${targetPath} but the module wasn't reloaded. ` +
          `Underlying error: ${(err as Error).message}`,
      );
    }

    try {
      await this.runSystem('modprobe', ['nonraid', `super=${targetPath}`]);
    } catch (err) {
      throw new Error(
        `Module reload failed after unloading — the array is currently down. ` +
          `Run manually: sudo modprobe nonraid super=${targetPath}` +
          `${backedUpTo ? ` (previous superblock backed up at ${backedUpTo})` : ''}. ` +
          `Underlying error: ${(err as Error).message}`,
      );
    }

    const { stdout } = await this.run(['import']);
    return parseImportOutput(stdout);
  }

  async commitImportedSuperblock(stagedFilePath: string): Promise<{ result: ImportResult; targetPath: string; backedUpTo: string | null }> {
    const targetPath = await this.getSuperblockPath();

    let backedUpTo: string | null = null;
    try {
      await this.runSystem('test', ['-f', targetPath]);
      backedUpTo = `${targetPath}.bak-import-${Date.now()}`;
      await this.runSystem('mv', [targetPath, backedUpTo]);
    } catch {
      // Nothing at targetPath yet — first-ever import, nothing to back up.
    }

    try {
      await this.runSystem('cp', [stagedFilePath, targetPath]);
    } catch (err) {
      // Restore the backup filename before surfacing the error — nothing
      // kernel-side has changed yet at this point, same recovery shape as
      // shrinkArray()'s modprobe-failure branch.
      if (backedUpTo) await this.runSystem('mv', [backedUpTo, targetPath]).catch(() => {});
      throw err;
    }

    const result = await this.stopUnloadReloadImport(targetPath, backedUpTo);
    return { result, targetPath, backedUpTo };
  }

  async reloadModuleAndImport(): Promise<ImportResult> {
    const targetPath = await this.getSuperblockPath();
    return this.stopUnloadReloadImport(targetPath, null);
  }

  async getStatus(): Promise<NmdStatusResponse> {
    const stdout = await this.runStatusJson(['status', '-o', 'json']);
    const parsed: unknown = JSON.parse(stdout);
    // nmdctl's -o json prints a valid-but-differently-shaped object on a genuinely blank array
    // (no array ever created — see nonraid's own tools/nmdctl, show_status()'s non-default-format
    // branch): `{"error": "..."}`, not the real NmdStatusResponse shape. `JSON.parse(...) as
    // NmdStatusResponse` alone doesn't check that at runtime, so every caller downstream (many —
    // confirmed live: this crashed both ShareService.remountAll() and ActivityWatcher.tick() with
    // two different, confusing "Cannot read properties of undefined" errors, not an obviously
    // array-related one) got a malformed object instead of a clean rejection. Throwing here once,
    // at the source, means every caller's existing try/catch around getStatus() already does the
    // right thing without needing its own defensive shape-check.
    if (!parsed || typeof parsed !== 'object' || !('array' in parsed) || !('disks' in parsed)) {
      if (parsed && typeof parsed === 'object' && 'error' in parsed) {
        throw new ArrayNotConfiguredError(String((parsed as { error: unknown }).error));
      }
      throw new Error('malformed status response');
    }
    return parsed as NmdStatusResponse;
  }

  /**
   * A plain `start` is refused in unattended mode whenever the array isn't
   * in the ordinary STOPPED state — e.g. DISABLE_DISK after a disk was just
   * unassigned (an intentional, expected state, not a problem: it means
   * "start running degraded, missing disk(s) emulated from parity"). nmdctl
   * requires that state to be named explicitly as a confirmation, so on a
   * plain-start refusal this re-checks status and retries once, naming
   * whatever it reported — the same pattern addDisk()/replaceDisk() already
   * use for the disk they just touched.
   *
   * Deliberately does NOT do this for a state prefixed "ERROR:" (confirmed
   * against the kernel driver source this session: TOO_MANY_MISSING_DISKS,
   * INVALID_EXPANSION, PARITY_NOT_BIGGEST, NEW_DISK_TOO_SMALL, and
   * NO_DATA_DISKS all bake that prefix into the state name itself at the
   * kernel level — every other abnormal state doesn't). Those genuinely can
   * mean something needs a human look before starting, not just a rubber
   * stamp, so this surfaces the real error instead of auto-confirming it.
   */
  async startArray(): Promise<NmdCommandResult> {
    try {
      const { stdout } = await this.run(['start']);
      return { ok: true, message: stdout.trim() };
    } catch (err) {
      const status = await this.getStatus();
      if (status.array.state === 'STARTED' || status.array.state.startsWith('ERROR:')) {
        throw err;
      }
      const { stdout } = await this.run(['start', status.array.state]);
      return { ok: true, message: stdout.trim() };
    }
  }

  async stopArray(): Promise<NmdCommandResult> {
    const { stdout } = await this.run(['stop']);
    return { ok: true, message: stdout.trim() };
  }

  async unmountDisks(): Promise<NmdCommandResult> {
    const { stdout } = await this.run(['unmount']);
    return { ok: true, message: stdout.trim() };
  }

  async mountDisks(): Promise<NmdCommandResult> {
    const { stdout } = await this.run(['mount']);
    return { ok: true, message: stdout.trim() };
  }

  async parityCheck(action: ParityCheckAction): Promise<NmdCommandResult> {
    // Same nmdctl unattended-mode quirk as commitNewDisk()/addDisk() above:
    // a pending non-check resync (e.g. "recon P", the array's first-ever
    // parity build) only accepts its own action word in -u mode, not
    // CORRECT/NOCORRECT — those always hit nmdctl's interactive-confirm
    // path and fail with "Cannot start parity check with another sync
    // operation pending (unattended mode)". PAUSE/RESUME/CANCEL are exempt
    // in nmdctl itself (handled before this check), so only substitute here.
    if (action === 'CORRECT' || action === 'NOCORRECT') {
      const status = await this.getStatus();
      if (status.resync.pending && !status.resync.action.trim().toLowerCase().startsWith('check')) {
        const pendingAction = status.resync.action.trim().split(/\s+/)[0]!;
        const { stdout } = await this.run(['check', pendingAction]);
        return { ok: true, message: stdout.trim() };
      }
    }
    const { stdout } = await this.run(['check', action]);
    return { ok: true, message: stdout.trim() };
  }

  async setWriteMethod(turbo: boolean): Promise<NmdCommandResult> {
    const { stdout } = await this.run(['set', 'md_write_method', turbo ? '1' : '0']);
    return { ok: true, message: stdout.trim() };
  }

  async setLabel(label: string): Promise<NmdCommandResult> {
    const { stdout } = await this.run(['set', 'label', label]);
    return { ok: true, message: stdout.trim() };
  }

  /** Major numbers for virtio-blk devices, read fresh — they're not fixed, unlike SCSI/SATA's. */
  private async getVirtioMajors(): Promise<string[]> {
    try {
      const text = await readFile('/proc/devices', 'utf8');
      const majors: string[] = [];
      for (const line of text.split('\n')) {
        const match = line.trim().match(/^(\d+)\s+virtblk$/);
        if (match?.[1]) majors.push(match[1]);
      }
      return majors;
    } catch {
      return [];
    }
  }

/**
   * Extends find_partition() in tools/nmdctl (the largest unmounted
   * partition on `dev`) with a harder rule that function doesn't have: if
   * *any* partition on the disk is currently mounted, the whole disk is
   * off-limits — not just that one partition. A disk actively serving
   * another purpose (e.g. this host's own boot disk, with one mounted root
   * partition and other small unused ones like a BIOS-boot partition) must
   * never be offered as "available," even via a technically-unmounted
   * sibling partition. This is the actual fix for a real incident this
   * project hit: offering an unused partition on the test VM's own boot
   * disk here, followed by a caller that (wrongly) used the whole-disk path
   * instead of that partition, zeroed the VM's entire root filesystem.
   * Returns `undefined` if the device should be excluded entirely, or the
   * largest unmounted partition's path (null if the disk has no partitions
   * at all — a genuinely blank disk, safe to use whole).
   */
  private async findAvailablePartition(dev: string): Promise<string | null | undefined> {
    try {
      const { stdout } = await execFileAsync('lsblk', ['--json', '-b', '-p', '-o', 'NAME,SIZE,MOUNTPOINT,TYPE', dev]);
      const tree = JSON.parse(stdout) as {
        blockdevices?: Array<{ children?: Array<{ name: string; size: number; mountpoint: string | null; type: string }> }>;
      };
      const partitions = (tree.blockdevices?.[0]?.children ?? []).filter((c) => c.type === 'part');
      if (partitions.some((p) => p.mountpoint)) return undefined;
      const unmounted = partitions.filter((p) => !p.mountpoint);
      if (unmounted.length === 0) return null;
      return unmounted.reduce((a, b) => (b.size > a.size ? b : a)).name;
    } catch {
      return null;
    }
  }

  private async scanDevice(dev: string): Promise<AvailableDevice | null> {
    const partition = await this.findAvailablePartition(dev);
    if (partition === undefined) return null; // disk has a mounted partition elsewhere — excluded entirely, see findAvailablePartition's doc comment

    let locked = false;
    try {
      const fd = openSync(partition ?? dev, constants.O_WRONLY | constants.O_EXCL);
      closeSync(fd);
    } catch {
      locked = true;
    }

    let diskId: string | null = null;
    let model: string | null = null;
    try {
      const { stdout } = await execFileAsync('udevadm', ['info', '--query=property', `--name=${dev}`]);
      const props = new Map(
        stdout
          .split('\n')
          .map((line) => {
            const i = line.indexOf('=');
            return i === -1 ? null : ([line.slice(0, i), line.slice(i + 1)] as [string, string]);
          })
          .filter((kv): kv is [string, string] => kv !== null),
      );
      diskId = props.get('ID_SERIAL')?.trim() || null;
      model = props.get('ID_MODEL')?.trim().replace(/_/g, ' ') || null;
    } catch {
      diskId = null;
      model = null;
    }

    let sizeKb: number | null = null;
    let uuid: string | null = null;
    try {
      const { stdout } = await execFileAsync('lsblk', ['-b', '-n', '-d', '-o', 'SIZE,UUID', partition ?? dev]);
      const [sizeStr, uuidStr] = stdout.trim().split(/\s+/);
      const bytes = Number(sizeStr);
      sizeKb = Number.isFinite(bytes) ? Math.round(bytes / 1024) : null;
      uuid = uuidStr || null;
    } catch {
      sizeKb = null;
      uuid = null;
    }

    const isSSD = await getDiskType(dev);

    return { device: dev, partition, sizeKb, diskId, model, uuid, locked, isSSD };
  }

  /** Every currently-visible block device path this app is willing to consider — shared by listAvailableDevices() and findDeviceByDiskId(). */
  private async enumerateDevicePaths(): Promise<string[]> {
    const virtioMajors = await this.getVirtioMajors();
    const majors = ['8', '65', '66', '67', '68', '69', '70', '71', ...virtioMajors];
    const { stdout } = await execFileAsync('lsblk', ['-n', '-d', '-p', '-I', majors.join(','), '-o', 'path']);
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  async listAvailableDevices(): Promise<AvailableDevice[]> {
    const status = await this.getStatus();
    const claimedIds = status.disks.map((d) => d.disk_id).filter((id): id is string => !!id && id !== 'none');

    // A disk actively serving as an array member is claimed by the driver and
    // re-exposed as its own block device (e.g. /dev/nmd5p1) — the *raw*
    // partition underneath (e.g. /dev/vdb1) never shows a mountpoint via
    // lsblk, since nothing mounts it directly; the array driver sits above
    // the OS mount layer entirely. That means neither the diskId match above
    // nor scanDevice()'s own OS-level mount check can see it: a virtio test
    // disk (or any real disk without a udev-visible serial) with no live
    // diskId would pass the check above AND read as "unmounted" — exactly
    // the shape of the incident that motivated the mount check in the first
    // place, just via a different blind spot. Cross-referencing basenames
    // against the array's own live device list closes it independently of
    // both existing checks.
    const claimedDeviceNames = new Set(
      status.disks.map((d) => d.device).filter((dev): dev is string => !!dev && dev !== 'none'),
    );

    const devicePaths = await this.enumerateDevicePaths();
    const scanned = await Promise.all(devicePaths.map((dev) => this.scanDevice(dev)));
    const devices = scanned.filter((d): d is AvailableDevice => d !== null);

    return devices.filter((d) => {
      if (claimedDeviceNames.has(basename(d.device)) || (d.partition && claimedDeviceNames.has(basename(d.partition)))) {
        return false;
      }
      // Same "already part of the array" filter add_disk() applies, matched
      // both directions since a real disk's udevadm ID_SERIAL and the
      // superblock's recorded disk_id aren't always byte-identical strings.
      if (!d.diskId) return true;
      return !claimedIds.some((id) => d.diskId!.includes(id) || id.includes(d.diskId!));
    });
  }

  /**
   * Mirrors get_disk_size_kb() in tools/nmdctl exactly: raw sectors via
   * blockdev, rounded *down* to a multiple of 8 (the driver's own
   * read/write granularity), then converted to 1024-byte KB. Confirmed live
   * against a real array's own already-imported disks that this genuinely
   * differs from scanDevice()'s plain lsblk-byte-size-rounded-to-KB by a few
   * KB whenever the raw sector count isn't itself a multiple of 8 — nmdctl
   * itself reports the aligned value (see status.disks[].size_kb), so
   * that's the number to predict here, not lsblk's.
   */
  private async alignedSizeKb(partitionOrDevice: string): Promise<number | null> {
    try {
      const { stdout } = await execFileAsync('blockdev', ['--getsz', partitionOrDevice]);
      const sectors = Number(stdout.trim());
      if (!Number.isFinite(sectors)) return null;
      return (Math.floor(sectors / 8) * 8) / 2;
    } catch {
      return null;
    }
  }

  async scanAllDisks(): Promise<AvailableDevice[]> {
    const devicePaths = await this.enumerateDevicePaths();
    const scanned = await Promise.all(devicePaths.map((dev) => this.scanDevice(dev)));
    const devices = scanned.filter((d): d is AvailableDevice => d !== null);
    // Only this method's callers (the import preview) need nmdctl-exact
    // sizes — scanDevice()'s own callers (listAvailableDevices(), the
    // Unassigned Devices list) just display it, where lsblk's number is
    // fine, so this corrects it here rather than in scanDevice() itself.
    await Promise.all(
      devices.map(async (d) => {
        d.sizeKb = await this.alignedSizeKb(d.partition ?? d.device);
      }),
    );
    return devices;
  }

  /**
   * Finds the physical device matching a disk_id regardless of what array
   * slot (if any) currently claims it — the opposite filter from
   * listAvailableDevices(), which deliberately excludes already-claimed
   * disks. Used by restoreUnassignedDisk() to re-locate a disk whose slot
   * still claims its identity but has lost the live device path.
   */
  private async findDeviceByDiskId(targetId: string): Promise<AvailableDevice | null> {
    const devicePaths = await this.enumerateDevicePaths();
    for (const dev of devicePaths) {
      const scanned = await this.scanDevice(dev);
      if (!scanned) continue;
      if (scanned.diskId && (scanned.diskId.includes(targetId) || targetId.includes(scanned.diskId))) {
        return scanned;
      }
      // No real udev serial to match on — check whether this device's own
      // path reproduces the target as a synthetic ID (see syntheticDiskId's
      // doc comment). Tried against both the whole device and its partition
      // — commitNewDisk() generates the fallback from whichever one was
      // actually passed to `add` at the time, and there's no way to tell
      // which from the ID string alone.
      if (
        targetId === syntheticDiskId(scanned.device) ||
        (scanned.partition && targetId === syntheticDiskId(scanned.partition))
      ) {
        return scanned;
      }
    }
    return null;
  }

  /**
   * True if `device` — or, when it's a partition, its parent disk, or any
   * *other* partition on that same parent disk — is mounted anywhere right
   * now. Fails safe: if this can't be determined for any reason, treats it
   * as mounted (blocks the caller) rather than risking a false "clear".
   */
  private async isDeviceOrSiblingMounted(device: string): Promise<boolean> {
    try {
      const { stdout: pkOut } = await execFileAsync('lsblk', ['-n', '-p', '-o', 'PKNAME', device]);
      const parent = pkOut.trim() || device;
      const { stdout } = await execFileAsync('lsblk', ['--json', '-b', '-p', '-o', 'NAME,MOUNTPOINT,TYPE', parent]);
      const tree = JSON.parse(stdout) as {
        blockdevices?: Array<{ mountpoint: string | null; children?: Array<{ mountpoint: string | null }> }>;
      };
      const root = tree.blockdevices?.[0];
      if (!root) return true;
      if (root.mountpoint) return true;
      return (root.children ?? []).some((c) => c.mountpoint);
    } catch {
      return true;
    }
  }

  /**
   * `add -f slot:device[:id]`, then start the array (naming whatever
   * abnormal state it reports, since unattended mode refuses to start in
   * one otherwise), then kick off any pending clear/reconstruction. Shared
   * tail for both addDisk() (empty slot) and replaceDisk() (occupied slot,
   * after it's cleared the old identity) — the sequence is identical once
   * the slot is actually empty, only how it got that way differs.
   */
  private async commitNewDisk(slot: number, device: string, diskId: string | undefined, lines: string[], autoStart = true): Promise<void> {
    const idSuffix = diskId ? `:${diskId}` : '';
    try {
      const { stdout } = await this.run(['add', '-f', `${slot}:${device}${idSuffix}`]);
      lines.push(stdout.trim());
    } catch (err) {
      const message = (err as Error).message;
      if (!diskId && /Could not determine disk ID/i.test(message)) {
        // No stable /dev/disk/by-id entry for this device (common for a
        // freshly-attached test VM disk with no `serial=` set) — fall back
        // to a synthetic ID rather than failing outright.
        const fallbackId = syntheticDiskId(device);
        const { stdout } = await this.run(['add', '-f', `${slot}:${device}:${fallbackId}`]);
        lines.push(stdout.trim());
      } else {
        throw err;
      }
    }

    // Assigning several disks in a row (building a new array from scratch)
    // skips straight past the start/check below for every disk but the
    // caller's own final, deliberate start — trying to start after each
    // individual add is both wasted work and, on a still-incomplete array,
    // a start nmdctl will just refuse (see the parity-only case noted below).
    if (!autoStart) return;

    const afterAdd = await this.getStatus();
    if (afterAdd.array.state !== 'STARTED') {
      try {
        const { stdout } = await this.run(['start']);
        lines.push(stdout.trim());
      } catch (err) {
        lines.push((err as Error).message);
        try {
          // Plain start refused (an "abnormal" state needs explicit naming
          // in unattended mode) — retry naming whatever state was just
          // reported.
          const { stdout } = await this.run(['start', afterAdd.array.state]);
          lines.push(stdout.trim());
        } catch (err2) {
          // A parity-only array (parity assigned, no data disks yet — the
          // first disk added to a blank array can be either) genuinely
          // can't start in unattended mode: nmdctl refuses with "No disks
          // imported." That's expected, not a failure of this add — the
          // `add` above already committed the slot assignment (confirmed
          // live: the disk shows up in status.disks immediately after,
          // even though this start attempt fails). Record it and move on
          // instead of throwing away a successful add.
          lines.push((err2 as Error).message);
        }
      }
    }

    const afterStart = await this.getStatus();
    // resync.action holds a stale/idle default label (e.g. "check P") even
    // when nothing is actually pending — checking it for mere truthiness
    // (as this used to) fires a bogus `check <word>` on every add/replace
    // that didn't need one, which the driver correctly rejects as an
    // invalid option. `pending` is the real signal.
    if (afterStart.resync.pending) {
      const pendingAction = afterStart.resync.action.trim().split(/\s+/)[0]!;
      const { stdout } = await this.run(['check', pendingAction]);
      lines.push(stdout.trim());
    }
  }

  /**
   * Assigns `device` to an *empty* slot — not for replacing an occupied one
   * (nmdctl's own `add` treats any slot with a recorded disk identity, even
   * one currently showing DISK_NP_MISSING, as a "replace", which for parity
   * specifically demands a spare data slot; that's replaceDisk()'s job, not
   * this one). Requires the array already stopped and the slot genuinely
   * empty; both checked fresh here.
   */
  async addDisk(slot: number, device: string, diskId?: string, options?: { autoStart?: boolean }): Promise<AddDiskResult> {
    const status = await this.getStatus();
    if (status.array.state === 'STARTED') {
      throw new Error('Stop the array before adding a disk.');
    }
    const existing = status.disks.find((d) => d.slot === slot);
    if (existing && existing.disk_id && existing.disk_id !== 'none') {
      throw new Error(`Slot ${slot} already has a disk assigned — unassign it first, or use Replace Disk.`);
    }

    // Hard backstop independent of whatever the caller scanned: refuse to
    // touch `device` if it, or any sibling partition on the same disk, is
    // currently mounted. `add -f` skips nmdctl's own availability scan
    // entirely (that's the whole point of -f), so this app owns this check
    // — see findAvailablePartition's doc comment for the real incident
    // (a whole-disk path reaching this method for a disk that also had a
    // live mounted root filesystem on another partition) this guards against.
    if (await this.isDeviceOrSiblingMounted(device)) {
      throw new Error(`${device} (or a partition on the same disk) is currently mounted — refusing to touch it.`);
    }

    const lines: string[] = [];
    await this.commitNewDisk(slot, device, diskId, lines, options?.autoStart ?? true);
    return { slot, message: `Disk assignment to slot ${slot} started.`, output: lines.join('\n\n') };
  }

  /**
   * The occupied-slot counterpart to addDisk(). nmdctl's `add` refuses any
   * slot with a recorded disk_id, even one just showing DISK_NP_MISSING —
   * so a genuine replacement first has to unassign the slot and *commit*
   * that via `start`, which is the actual step that clears the old identity
   * (verified against the kernel driver source this session: a committed
   * DISABLE_DISK pass calls record_disk_info on every DISK_NP_MISSING slot,
   * wiping its id). That's correct and intentional for a real replacement —
   * from that point on, the driver stops trusting whatever's physically on
   * the old disk and will rebuild the new one from parity instead — but
   * it's irreversible. If the goal is actually restoring the *same* disk,
   * use restoreUnassignedDisk() instead, before this runs.
   */
  async replaceDisk(slot: number, device: string, diskId?: string): Promise<AddDiskResult> {
    const status = await this.getStatus();
    if (status.array.state === 'STARTED') {
      throw new Error('Stop the array before replacing a disk.');
    }
    const existing = status.disks.find((d) => d.slot === slot);
    if (!existing || !existing.disk_id || existing.disk_id === 'none') {
      throw new Error(`Slot ${slot} is empty — use Add Disk instead.`);
    }
    if (await this.isDeviceOrSiblingMounted(device)) {
      throw new Error(`${device} (or a partition on the same disk) is currently mounted — refusing to touch it.`);
    }

    const lines: string[] = [];

    if (existing.status !== 'DISK_NP_DSBL') {
      // Not yet unassigned+committed for this slot — do that first. Skips
      // cleanly if some earlier, separate action already left it committed.
      await this.writeNmdCmd(`import ${slot} '' 0 0 0 ''`);
      lines.push(`Slot ${slot} unassigned.`);

      const afterUnassign = await this.getStatus();
      try {
        const { stdout } = await this.run(['start']);
        lines.push(stdout.trim());
      } catch {
        const { stdout } = await this.run(['start', afterUnassign.array.state]);
        lines.push(stdout.trim());
      }
      await this.run(['stop']);
      lines.push(`Slot ${slot}'s previous disk identity cleared.`);
    }

    await this.commitNewDisk(slot, device, diskId, lines);
    return { slot, message: `Slot ${slot} replaced, rebuild started.`, output: lines.join('\n\n') };
  }

  /**
   * Undoes an *uncommitted* unassign (DISK_NP_MISSING with disk_id still
   * intact — confirmed this session that a committed unassign clears it,
   * but an uncommitted one doesn't touch it at all). Re-locates the
   * physical device by that still-recorded id rather than trusting a path,
   * since device enumeration order isn't stable across reboots, then
   * re-imports it with matching identity and size — landing back on
   * DISK_OK directly, no clear or parity rebuild involved, since nothing
   * about the disk's own recorded state ever actually changed.
   */
  async restoreUnassignedDisk(slot: number): Promise<NmdCommandResult> {
    const status = await this.getStatus();
    if (status.array.state === 'STARTED') {
      throw new Error('Array must be stopped to restore a disk.');
    }
    const disk = status.disks.find((d) => d.slot === slot);
    if (!disk || disk.status !== 'DISK_NP_MISSING') {
      throw new Error(`Slot ${slot} isn't a pending, uncommitted unassign — nothing to restore.`);
    }
    if (!disk.disk_id || disk.disk_id === 'none') {
      throw new Error(`Slot ${slot} has no recorded identity to restore.`);
    }

    const found = await this.findDeviceByDiskId(disk.disk_id);
    if (!found) {
      throw new Error(`Could not find a physical device matching slot ${slot}'s recorded ID (${disk.disk_id}) — is the disk connected?`);
    }
    if (disk.size_kb && found.sizeKb && Math.abs(found.sizeKb - disk.size_kb) > 1024) {
      throw new Error(
        `Size mismatch for slot ${slot}: recorded ${disk.size_kb} KB, found device is ${found.sizeKb} KB — refusing, this may not be the same disk.`,
      );
    }

    const target = found.partition ?? found.device;
    await this.writeNmdCmd(`import ${slot} ${basename(target)} 0 ${disk.size_kb} 0 ${disk.disk_id}`);

    return { ok: true, message: `Slot ${slot} restored to its previous disk. Start the array to confirm it's healthy again.` };
  }

  async formatDisk(slot: number, force = false): Promise<NmdCommandResult> {
    const status = await this.getStatus();
    const disk = status.disks.find((d) => d.slot === slot);
    if (!disk) throw new Error(`No disk assigned to slot ${slot}.`);
    if (status.resync.active) {
      throw new Error(`A clear/sync operation is still running on slot ${slot} — wait for it to finish first.`);
    }
    // Checked ahead of the force branch below and never bypassable by it: force is for wiping a
    // disk's own foreign, unmounted data, not for reformatting over a live mounted member (which
    // would be destroying this array's own working data, not a foreign filesystem).
    // nmdctl's own JSON status reports an unmounted filesystem's mountpoint as the literal word
    // "unmounted", not empty/null — confirmed against tools/nmdctl's get_mountpoint() default
    // (docker/storagePath.ts and lxc/storagePath.ts already check for this same sentinel). A bare
    // truthiness check treats that word as a real path and refuses every genuinely-unmounted disk,
    // confirmed live: force-format on a freshly-cleared, never-mounted disk failed with "currently
    // mounted at unmounted" until this was excluded.
    if (disk.filesystem?.mountpoint && disk.filesystem.mountpoint !== 'unmounted') {
      throw new Error(`Slot ${slot} is currently mounted at ${disk.filesystem.mountpoint} — unmount it (or unassign the disk) before formatting.`);
    }
    if (!force && disk.filesystem && disk.filesystem.type && disk.filesystem.type !== 'unknown') {
      throw new Error(`Slot ${slot} already has a filesystem (${disk.filesystem.type}) — refusing to reformat over existing data. Pass force to overwrite it.`);
    }

    const partition = `/dev/nmd${slot}p1`;
    const mkfsArgs = force ? ['-f', partition] : [partition];
    const bin = config.nmdUseSudo ? 'sudo' : 'mkfs.xfs';
    const args = config.nmdUseSudo ? ['mkfs.xfs', ...mkfsArgs] : mkfsArgs;
    try {
      // Without force, no -f is passed: mkfs.xfs refuses on its own if the partition already
      // carries a recognized filesystem/RAID signature — a real safety backstop, not just this
      // app's own check above. force=true passes -f, deliberately discarding that backstop for a
      // disk carrying data from outside this array (e.g. reused from another system) that the
      // caller has already confirmed — via the frontend's own two-step confirmation dialog — is
      // safe to destroy.
      const { stdout } = await execFileAsync(bin, args, { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
      await this.run(['mount']);
      return { ok: true, message: stdout.trim() || `Formatted ${partition} as XFS and mounted it.` };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      throw new Error(e.stderr?.trim() || e.stdout?.trim() || e.message);
    }
  }

  async unassignDisk(slot: number): Promise<NmdCommandResult> {
    // Same safety checks nmdctl's own (interactive-only) unassign_disk() does,
    // read fresh right before acting.
    const status = await this.getStatus();

    if (status.array.state === 'STARTED') {
      throw new Error('Array must be stopped before unassigning disks.');
    }

    const disk = status.disks.find((d) => d.slot === slot);
    if (!disk || disk.status === 'DISK_NP_DSBL') {
      throw new Error(`No disk assigned to slot ${slot}, or it's already unassigned.`);
    }

    const parityCount = status.disks.filter((d) => (d.type === 'P' || d.type === 'Q') && d.size_gb > 0).length;
    const alreadyMissing = status.disks.filter((d) => d.status === 'DISK_NP_MISSING' || d.status === 'DISK_NP_DSBL').length;
    if (alreadyMissing + 1 > parityCount) {
      throw new Error(
        `Not enough parity to unassign another disk (parity disks: ${parityCount}, already missing: ${alreadyMissing}).`,
      );
    }

    // The exact command nmdctl's unassign_disk() issues internally — importing
    // the slot with an empty device unassigns it. Unassigning the same slot
    // twice is a known driver bug (bumps the missing-disk counter twice and
    // forces TOO_MANY_MISSING_DISKS, needing a driver reload) — the DISK_NP_DSBL
    // check above guards against that.
    await this.writeNmdCmd(`import ${slot} '' 0 0 0 ''`);

    return { ok: true, message: `Slot ${slot} unassigned. Start the array to commit the change.` };
  }
}
