import type { NmdClient } from './client.js';
import { buildMockDisk, getMockDiskSeeds } from './mockData.js';
import type { NmdCommandResult, NmdResyncStatus, NmdStatusResponse, ParityCheckAction } from './types.js';

interface MockState {
  arrayStarted: boolean;
  label: string;
  resync: NmdResyncStatus;
  lastSyncTimestamp: number;
  lastSyncElapsed: number;
  /** Slots unassigned via unassignDisk(), matching real driver semantics:
   *  DISK_NP_DSBL while stopped, DISK_NP_MISSING (emulated from parity) once
   *  the array is started again with the slot still empty. */
  unassignedSlots: Set<number>;
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
    }
  }

  async getStatus(): Promise<NmdStatusResponse> {
    const { arrayStarted, resync, unassignedSlots } = this.state;
    const { all: seeds, data: dataSeeds, parity: paritySeeds } = getMockDiskSeeds();
    const disks = seeds.map((seed) => {
      const disk = buildMockDisk(seed, arrayStarted);
      if (unassignedSlots.has(seed.slot)) {
        disk.status = arrayStarted ? 'DISK_NP_MISSING' : 'DISK_NP_DSBL';
      }
      return disk;
    });

    const missingCount = arrayStarted ? unassignedSlots.size : 0;
    const disabledCount = arrayStarted ? 0 : unassignedSlots.size;
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
        disks_present: seeds.length,
        disks_imported: arrayStarted ? seeds.length : 0,
        disks_unassigned: 0,
        total_slots: 30,
        health,
        size: {
          data_gb: dataSeeds.reduce((s, d) => s + d.sizeGb, 0),
          data_disk_count: dataSeeds.length,
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
          sync_errors: 0,
          disk_errors: 0,
        },
        last_sync: {
          timestamp: this.state.lastSyncTimestamp,
          age_seconds: Math.floor(Date.now() / 1000) - this.state.lastSyncTimestamp,
          elapsed_seconds: this.state.lastSyncElapsed,
          status: 'OK',
        },
      },
      resync,
      disks,
    };
  }

  async startArray(): Promise<NmdCommandResult> {
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

  async unassignDisk(slot: number): Promise<NmdCommandResult> {
    if (this.state.arrayStarted) {
      throw new Error('Array must be stopped before unassigning disks.');
    }

    const { all: seeds, parity: paritySeeds } = getMockDiskSeeds();
    const seed = seeds.find((s) => s.slot === slot);
    if (!seed || this.state.unassignedSlots.has(slot)) {
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
