import type { NmdClient } from './client.js';
import { buildMockDisk, getMockDiskSeeds } from './mockData.js';
import type {
  AddDiskResult,
  AvailableDevice,
  ImportResult,
  NmdCommandResult,
  NmdDisk,
  NmdResyncStatus,
  NmdStatusResponse,
  ParityCheckAction,
} from './types.js';

interface MockAddedDisk {
  slot: number;
  device: string;
  diskId: string;
  sizeGb: number;
  cleared: boolean;
}

interface MockState {
  arrayStarted: boolean;
  label: string;
  resync: NmdResyncStatus;
  lastSyncTimestamp: number;
  lastSyncElapsed: number;
  /** Slots unassigned via unassignDisk() but not yet committed via a
   *  subsequent start — matches the real driver (confirmed against the
   *  kernel source and real hardware this session): unassigning a
   *  previously-valid disk shows DISK_NP_MISSING immediately, with its
   *  disk_id still intact, regardless of whether the array is started or
   *  stopped. Only a committed start (see committedUnassignedSlots) clears
   *  the identity. */
  unassignedSlots: Set<number>;
  /** Slots whose unassign has been committed via a `start` since — matches
   *  DISK_NP_DSBL with disk_id cleared, the point past which restoring the
   *  same disk is no longer possible (see restoreUnassignedDisk()). */
  committedUnassignedSlots: Set<number>;
  /** Slots removed from the topology entirely via shrinkArray() — unlike
   *  committedUnassignedSlots (still shown as DISABLED), these stop
   *  appearing in getStatus() at all, matching a real reconfigure. */
  droppedSlots: Set<number>;
  /** Slots assigned via addDisk() — not part of getMockDiskSeeds()'s fixed
   *  set, so tracked separately and merged into getStatus()'s disk list. */
  addedDisks: Map<number, MockAddedDisk>;
  /** Which addedDisks entry the current resync (if its action is 'clear')
   *  is clearing — resync is a single shared field, same as real hardware
   *  only ever running one sync/clear/check operation at a time. */
  clearingSlot: number | null;
}

function idleResync(totalGb: number): NmdResyncStatus {
  return {
    active: false,
    paused: false,
    pending: false,
    action: '',
    progress_percent: 100,
    position_gb: totalGb,
    size_gb: totalGb,
    rate_mb_s: 0,
    elapsed_seconds: 0,
    eta_seconds: 0,
  };
}

/**
 * Simulates a healthy nonraid array in memory, for local dev on machines
 * without the real nonraid kernel module loaded. Ticks parity-check progress
 * on an interval, same as real hardware would, so the API behaves like the
 * real thing from the frontend's perspective. Disk data comes from
 * getMockDiskSeeds() — real disks when a dev VM has a real array mounted,
 * fictional ones otherwise (see mockData.ts).
 */
export class MockNmdClient implements NmdClient {
  readonly mode = 'mock' as const;

  private state: MockState;
  private timer: NodeJS.Timeout;

  constructor() {
    const totalGb = this.totalDataGb();
    this.state = {
      arrayStarted: true,
      label: 'nonraid-mock',
      resync: idleResync(totalGb),
      lastSyncTimestamp: Math.floor(Date.now() / 1000) - 3 * 86400,
      lastSyncElapsed: 5400,
      unassignedSlots: new Set(),
      committedUnassignedSlots: new Set(),
      droppedSlots: new Set(),
      addedDisks: new Map(),
      clearingSlot: null,
    };
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
  }

  private totalDataGb(): number {
    return getMockDiskSeeds().data.reduce((s, d) => s + d.sizeGb, 0);
  }

  private tick() {
    const r = this.state.resync;
    if (!r.active || r.paused || !this.state.arrayStarted) return;

    const increment = 0.5 + Math.random() * 1.5;
    const nextPct = Math.min(100, r.progress_percent + increment);
    r.progress_percent = nextPct;
    r.position_gb = Math.round((nextPct / 100) * r.size_gb);
    r.elapsed_seconds += 1;
    r.rate_mb_s = 140 + Math.round(Math.random() * 30);
    const remainingPct = 100 - nextPct;
    r.eta_seconds = Math.round((remainingPct / Math.max(increment, 0.1)) * 1);

    if (nextPct >= 100) {
      this.state.resync = idleResync(r.size_gb);
      this.state.lastSyncTimestamp = Math.floor(Date.now() / 1000);
      this.state.lastSyncElapsed = r.elapsed_seconds;

      if (this.state.clearingSlot !== null) {
        const disk = this.state.addedDisks.get(this.state.clearingSlot);
        if (disk) disk.cleared = true;
        this.state.clearingSlot = null;
      }
    }
  }

  private buildAddedDisk(added: MockAddedDisk, arrayStarted: boolean): NmdDisk {
    const sizeKb = added.sizeGb * 1024 * 1024;
    return {
      slot: added.slot,
      type: 'data',
      size_kb: sizeKb,
      size_gb: added.sizeGb,
      device: arrayStarted ? `/dev/nmd${added.slot}p1` : added.device,
      status: added.cleared ? 'DISK_OK' : 'DISK_NEW',
      errors: 0,
      reads: 0,
      writes: 0,
      disk_id: added.diskId,
      disk_name: `disk${added.slot}`,
      ...(added.cleared
        ? { filesystem: { type: 'xfs', mountpoint: arrayStarted ? `/mnt/disk${added.slot}` : '-', usage: arrayStarted ? '0%' : '-' } }
        : {}),
    };
  }

  async getStatus(): Promise<NmdStatusResponse> {
    const { arrayStarted, resync, unassignedSlots, committedUnassignedSlots } = this.state;
    const { all: seeds, data: dataSeeds, parity: paritySeeds } = getMockDiskSeeds();
    const disks = seeds
      .filter((seed) => !this.state.droppedSlots.has(seed.slot)) // shrinkArray() removed this slot from the topology entirely
      .filter((seed) => !this.state.addedDisks.has(seed.slot)) // replaceDisk() has taken over this slot — show the addedDisks entry instead
      .map((seed) => {
        const disk = buildMockDisk(seed, arrayStarted);
        if (unassignedSlots.has(seed.slot)) {
          // Uncommitted: identity stays intact, matching the real driver.
          disk.status = 'DISK_NP_MISSING';
          disk.device = 'none';
        } else if (committedUnassignedSlots.has(seed.slot)) {
          // Committed: identity cleared — restoreUnassignedDisk() no longer applies.
          disk.status = 'DISK_NP_DSBL';
          disk.device = 'none';
          disk.disk_id = 'none';
        }
        return disk;
      });
    for (const added of this.state.addedDisks.values()) {
      disks.push(this.buildAddedDisk(added, arrayStarted));
    }

    const missingCount = unassignedSlots.size;
    const disabledCount = committedUnassignedSlots.size;
    let health: { status: 'HEALTHY' | 'DEGRADED' | 'READY'; details: string; code: number };
    if (!arrayStarted) {
      health = { status: 'READY', details: '', code: 0 };
    } else if (missingCount > 0) {
      health = { status: 'DEGRADED', details: `${missingCount} disk(s) missing — unassigned via the API`, code: 1 };
    } else {
      health = { status: 'HEALTHY', details: '', code: 0 };
    }

    return {
      array: {
        label: this.state.label,
        state: arrayStarted ? 'STARTED' : 'STOPPED',
        superblock: '/nonraid.dat',
        disks_present: disks.length,
        disks_imported: arrayStarted ? disks.length : 0,
        disks_unassigned: 0,
        total_slots: 30,
        health,
        size: {
          data_gb: dataSeeds.reduce((s, d) => s + d.sizeGb, 0) + [...this.state.addedDisks.values()].reduce((s, d) => s + d.sizeGb, 0),
          data_disk_count: dataSeeds.length + this.state.addedDisks.size,
          has_parity: paritySeeds.length > 0,
          has_second_parity: paritySeeds.length > 1,
          parity_size_gb: paritySeeds[0]?.sizeGb ?? 0,
          second_parity_size_gb: paritySeeds[1]?.sizeGb ?? 0,
        },
        counters: {
          missing: missingCount,
          invalid: 0,
          wrong: 0,
          disabled: disabledCount,
          replaced: 0,
          new: 0,
          sync_errors: 0, // this mock never injects sync errors
          disk_errors: 0,
        },
        last_sync: {
          timestamp: this.state.lastSyncTimestamp,
          age_seconds: Math.floor(Date.now() / 1000) - this.state.lastSyncTimestamp,
          elapsed_seconds: this.state.lastSyncElapsed,
          // Mirrors real nmdctl's last_sync_status values (see format_json_output()
          // in tools/nmdctl): 'never' before any sync has completed, 'in_progress'
          // while one's running, else 'completed' otherwise (this mock never
          // injects sync errors, so 'errors' never applies here).
          status: this.state.lastSyncTimestamp === 0 ? 'never' : resync.active ? 'in_progress' : 'completed',
        },
      },
      resync,
      disks,
    };
  }

  async startArray(): Promise<NmdCommandResult> {
    // Commit any pending unassigns — matches the real driver: a start while
    // a slot is still uncommitted-missing is what actually clears its
    // identity (DISK_NP_MISSING -> DISK_NP_DSBL), the point past which
    // restoreUnassignedDisk() no longer applies.
    for (const slot of this.state.unassignedSlots) {
      this.state.unassignedSlots.delete(slot);
      this.state.committedUnassignedSlots.add(slot);
    }
    this.state.arrayStarted = true;
    return { ok: true, message: 'Array started' };
  }

  async stopArray(): Promise<NmdCommandResult> {
    if (this.state.resync.active) {
      throw new Error('Cannot stop array while a parity check is running. Pause or cancel it first.');
    }
    this.state.arrayStarted = false;
    return { ok: true, message: 'Array stopped' };
  }

  async unmountDisks(): Promise<NmdCommandResult> {
    return { ok: true, message: 'Disks unmounted (mock)' };
  }

  async mountDisks(): Promise<NmdCommandResult> {
    return { ok: true, message: 'Disks mounted (mock)' };
  }

  async parityCheck(action: ParityCheckAction): Promise<NmdCommandResult> {
    if (!this.state.arrayStarted) {
      throw new Error('Array must be started before running a parity check.');
    }
    const r = this.state.resync;

    switch (action) {
      case 'CORRECT':
      case 'NOCORRECT':
        this.state.resync = {
          ...idleResync(this.totalDataGb()),
          active: true,
          paused: false,
          progress_percent: 0,
          position_gb: 0,
          action: action === 'CORRECT' ? 'check' : 'check nocorrect',
          rate_mb_s: 150,
        };
        return { ok: true, message: 'Parity check started' };
      case 'PAUSE':
        if (!r.active) throw new Error('No parity check is running.');
        r.paused = true;
        return { ok: true, message: 'Parity check paused' };
      case 'RESUME':
        if (!r.active) throw new Error('No parity check to resume.');
        r.paused = false;
        return { ok: true, message: 'Parity check resumed' };
      case 'CANCEL':
        this.state.resync = idleResync(r.size_gb);
        if (r.progress_percent < 100) {
          this.state.resync.progress_percent = 0;
          this.state.resync.position_gb = 0;
        }
        return { ok: true, message: 'Parity check cancelled' };
      default:
        throw new Error(`Unknown parity check action: ${action satisfies never}`);
    }
  }

  async setWriteMethod(turbo: boolean): Promise<NmdCommandResult> {
    // Mirrors the real driver's own lack of readback — accepted and applied
    // (nothing to actually simulate), but not reflected anywhere in getStatus().
    return { ok: true, message: turbo ? 'Turbo write enabled (mock)' : 'Standard write mode (mock)' };
  }

  async setLabel(label: string): Promise<NmdCommandResult> {
    if (this.state.arrayStarted) {
      throw new Error('Label can only be set when the array is stopped.');
    }
    this.state.label = label;
    return { ok: true, message: `Array label set to "${label}"` };
  }

  async importDisks(): Promise<ImportResult> {
    if (this.state.arrayStarted) {
      throw new Error('Array must be stopped before importing.');
    }
    const count = getMockDiskSeeds().all.length;
    return {
      importedCount: count,
      sizeMismatches: [],
      errors: [],
      output: `Scanning array configuration...\n\nImporting ${count} disks...\n\nSuccessfully imported ${count} disk(s) (mock)\n`,
    };
  }

  async listAvailableDevices(): Promise<AvailableDevice[]> {
    // A couple of fixed fake candidates — enough to exercise the "Unassigned
    // Devices" UI in mock mode without depending on real host hardware.
    const candidates: AvailableDevice[] = [
      {
        device: '/dev/sdx',
        partition: '/dev/sdx1',
        sizeKb: 500 * 1024 * 1024,
        diskId: 'MOCK_SPARE_1',
        model: 'Mock 500GB SSD',
        uuid: 'a1b2c3d4-0000-0000-0000-000000000001',
        locked: false,
      },
      {
        device: '/dev/sdy',
        partition: null,
        sizeKb: 1000 * 1024 * 1024,
        diskId: 'MOCK_SPARE_2',
        model: 'Mock 1TB HDD',
        uuid: null,
        locked: false,
      },
    ];
    // Drop any this mock's own addDisk() already claimed.
    const addedDevices = new Set([...this.state.addedDisks.values()].map((d) => d.device));
    return candidates.filter((c) => !addedDevices.has(c.device));
  }

  async addDisk(slot: number, device: string, diskId?: string): Promise<AddDiskResult> {
    if (this.state.arrayStarted) {
      throw new Error('Stop the array before adding a disk.');
    }
    const seedExists = getMockDiskSeeds().all.some((s) => s.slot === slot);
    const identityCleared = this.state.committedUnassignedSlots.has(slot);
    const existing = (seedExists && !identityCleared) || this.state.addedDisks.has(slot);
    if (existing) {
      throw new Error(`Slot ${slot} already has a disk assigned — unassign it first, or use Replace Disk.`);
    }

    this.assignDiskToSlot(slot, device, diskId);
    return { slot, message: `Disk assignment to slot ${slot} started (mock).`, output: `Adding ${device} to slot ${slot} (mock)\nClearing started (mock)` };
  }

  /** Shared tail for addDisk() and replaceDisk() — registers the new disk and starts the mock "clearing" resync, same as real hardware's parity rebuild. */
  private assignDiskToSlot(slot: number, device: string, diskId?: string): void {
    const sizeGb = 30; // matches the real test disk this feature was built and verified against
    this.state.addedDisks.set(slot, { slot, device, diskId: diskId ?? `MOCK_${device.replace(/[^a-zA-Z0-9]+/g, '_')}`, sizeGb, cleared: false });
    this.state.arrayStarted = true;
    this.state.clearingSlot = slot;
    this.state.resync = {
      ...idleResync(sizeGb),
      active: true,
      paused: false,
      progress_percent: 0,
      position_gb: 0,
      action: 'clear',
      rate_mb_s: 45,
    };
  }

  /**
   * Occupied-slot counterpart to addDisk() — mirrors realClient's
   * replaceDisk(): commits any pending unassign first (clearing the old
   * identity, matching the real driver), then assigns the new disk the same
   * way addDisk() does.
   */
  async replaceDisk(slot: number, device: string, diskId?: string): Promise<AddDiskResult> {
    if (this.state.arrayStarted) {
      throw new Error('Stop the array before replacing a disk.');
    }
    const seedExists = getMockDiskSeeds().all.some((s) => s.slot === slot);
    if (!seedExists && !this.state.addedDisks.has(slot)) {
      throw new Error(`Slot ${slot} is empty — use Add Disk instead.`);
    }

    const lines: string[] = [];
    if (!this.state.committedUnassignedSlots.has(slot)) {
      this.state.unassignedSlots.delete(slot);
      this.state.committedUnassignedSlots.add(slot);
      this.state.addedDisks.delete(slot);
      lines.push(`Slot ${slot} unassigned.`, `Slot ${slot}'s previous disk identity cleared.`);
    }

    this.assignDiskToSlot(slot, device, diskId);
    lines.push(`Adding ${device} to slot ${slot} (mock)`, 'Clearing started (mock)');
    return { slot, message: `Slot ${slot} replaced, rebuild started (mock).`, output: lines.join('\n') };
  }

  /** Mirrors realClient's shrinkArray() at the state-model level — no real module reload to simulate, just removes the slot from the topology for good. */
  async shrinkArray(dropSlots: number[]): Promise<NmdCommandResult> {
    if (!this.state.arrayStarted) {
      throw new Error('Array must be started (so live device paths can be read) before shrinking it.');
    }
    if (dropSlots.length === 0) throw new Error('No slots given to drop.');
    for (const slot of dropSlots) {
      if (!this.state.committedUnassignedSlots.has(slot)) {
        throw new Error(`Slot ${slot} isn't a committed-disabled slot — unassign and commit it first.`);
      }
    }
    for (const slot of dropSlots) {
      this.state.committedUnassignedSlots.delete(slot);
      this.state.droppedSlots.add(slot);
    }
    return { ok: true, message: `Array reconfigured to drop slot(s) ${dropSlots.join(', ')} (mock).` };
  }

  /**
   * Undoes an uncommitted unassign — only while the slot is still in
   * unassignedSlots (DISK_NP_MISSING, identity intact). Once startArray()
   * has promoted it to committedUnassignedSlots the identity is gone, same
   * as the real driver, and this no longer applies.
   */
  async restoreUnassignedDisk(slot: number): Promise<NmdCommandResult> {
    if (this.state.arrayStarted) {
      throw new Error('Array must be stopped to restore a disk.');
    }
    if (!this.state.unassignedSlots.has(slot)) {
      throw new Error(`Slot ${slot} isn't a pending, uncommitted unassign — nothing to restore.`);
    }
    this.state.unassignedSlots.delete(slot);
    return { ok: true, message: `Slot ${slot} restored to its previous disk. Start the array to confirm it's healthy again.` };
  }

  async formatDisk(slot: number): Promise<NmdCommandResult> {
    if (this.state.resync.active) {
      throw new Error(`A clear/sync operation is still running on slot ${slot} — wait for it to finish first.`);
    }
    const added = this.state.addedDisks.get(slot);
    if (added) {
      if (!added.cleared) throw new Error(`Slot ${slot} hasn't finished clearing yet.`);
      added.cleared = true; // already formatted-equivalent in the mock's own buildAddedDisk() once cleared
      return { ok: true, message: `Formatted slot ${slot} as XFS and mounted it (mock).` };
    }
    const seed = getMockDiskSeeds().all.find((s) => s.slot === slot);
    if (!seed) throw new Error(`No disk assigned to slot ${slot}.`);
    throw new Error(`Slot ${slot} already has a filesystem (${seed.fsType}) — refusing to reformat over existing data.`);
  }

  async unassignDisk(slot: number): Promise<NmdCommandResult> {
    if (this.state.arrayStarted) {
      throw new Error('Array must be stopped before unassigning disks.');
    }

    const { all: seeds, parity: paritySeeds } = getMockDiskSeeds();
    const seed = seeds.find((s) => s.slot === slot);
    if (!seed || this.state.unassignedSlots.has(slot) || this.state.committedUnassignedSlots.has(slot)) {
      throw new Error(`No disk assigned to slot ${slot}, or it's already unassigned.`);
    }

    const alreadyMissing = this.state.unassignedSlots.size;
    if (alreadyMissing + 1 > paritySeeds.length) {
      throw new Error(
        `Not enough parity to unassign another disk (parity disks: ${paritySeeds.length}, already missing: ${alreadyMissing}).`,
      );
    }

    this.state.unassignedSlots.add(slot);
    return { ok: true, message: `Slot ${slot} unassigned. Start the array to commit the change.` };
  }
}
