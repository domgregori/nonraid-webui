import { mockDeviceTemps } from '../nmd/mockData.js';
import type { SelfTestHistoryEntry, SelfTestStatus, SelfTestType, SmartAttributes, SmartClient, SmartHealth } from './types.js';

// Fast durations so a self-test is demoable in dev without waiting on a real
// drive's hours-long run — this project's environment has no SMART-capable
// disk to test against for real (see the Disks tab handoff).
const MOCK_DURATIONS_MS: Record<SelfTestType, number> = {
  short: 20_000,
  conveyance: 15_000,
  long: 45_000,
};

interface MockSelfTestRun {
  type: SelfTestType;
  startedAt: number;
  durationMs: number;
  /** True once a completed run has been reported to a caller as 'passed' — the next read clears it to idle. */
  recorded: boolean;
}

/** Deterministic string hash, used to fake a stable per-device baseline for devices with no precomputed entry. */
function hashDevice(device: string): number {
  let h = 0;
  for (let i = 0; i < device.length; i++) h = (h * 31 + device.charCodeAt(i)) >>> 0;
  return h;
}

export class MockSmartClient implements SmartClient {
  readonly mode = 'mock' as const;
  private baseline = mockDeviceTemps();
  private runs = new Map<string, MockSelfTestRun>();
  private history = new Map<string, SelfTestHistoryEntry[]>();

  /**
   * Precomputed baseline (see mockDeviceTemps()) when the device string
   * matches its `/dev/nmdXp1`-style assumptions — but the active NmdClient
   * can be real (NMD_MODE=real, SMART_MODE=mock, e.g. the nonraid-test VM)
   * and report a differently-shaped device string, like the bare `vdb1`
   * nmdctl reports for a virtio-blk disk. Falling back to a hash-derived
   * baseline means any device the active NmdClient actually reports gets a
   * stable fake reading instead of a silent null, without this class having
   * to know which NmdClient is in play.
   */
  private baselineFor(device: string): number {
    return this.baseline[device] ?? 28 + (hashDevice(device) % 15); // 28-42°C, same range as mockDeviceTemps()
  }

  async getTemperature(device: string): Promise<number | null> {
    const base = this.baselineFor(device);
    // small jitter so it reads as a live sensor rather than a static fixture
    return Math.round((base + (Math.random() * 2 - 1)) * 10) / 10;
  }

  async getHealth(_device: string): Promise<SmartHealth | null> {
    return 'passed';
  }

  private currentSelfTest(device: string): SelfTestStatus {
    const run = this.runs.get(device);
    if (!run) return { state: 'idle', type: null, progressPct: null, statusText: null };

    const elapsed = Date.now() - run.startedAt;
    if (elapsed < run.durationMs) {
      const progressPct = Math.min(99, Math.round((elapsed / run.durationMs) * 100));
      return { state: 'running', type: run.type, progressPct, statusText: `${run.type} self-test in progress` };
    }

    if (!run.recorded) {
      run.recorded = true;
      const entries = this.history.get(device) ?? [];
      entries.unshift({
        type: run.type,
        status: 'Completed without error',
        passed: true,
        lifetimeHours: 1200 + Math.floor(Math.random() * 500),
      });
      this.history.set(device, entries.slice(0, 10));
      return { state: 'passed', type: run.type, progressPct: 100, statusText: 'Completed without error' };
    }

    this.runs.delete(device);
    return { state: 'idle', type: null, progressPct: null, statusText: null };
  }

  async getAttributes(device: string): Promise<SmartAttributes | null> {
    const base = this.baselineFor(device);

    return {
      device,
      model: 'Mock Drive',
      serial: `MOCK-${device.replace(/\W+/g, '-')}`,
      capacityBytes: null,
      health: 'passed',
      temperature: Math.round((base + (Math.random() * 2 - 1)) * 10) / 10,
      powerOnHours: 8760 + Math.floor(base * 10),
      powerCycleCount: 42,
      reallocatedSectors: 0,
      pendingSectors: 0,
      uncorrectableSectors: 0,
      selfTest: this.currentSelfTest(device),
      selfTestHistory: this.history.get(device) ?? [],
      capabilities: { short: true, long: true, conveyance: true },
    };
  }

  async startSelfTest(device: string, type: SelfTestType): Promise<void> {
    const existing = this.runs.get(device);
    if (existing && Date.now() - existing.startedAt < existing.durationMs) {
      throw new Error('A self-test is already in progress on this disk.');
    }
    this.runs.set(device, { type, startedAt: Date.now(), durationMs: MOCK_DURATIONS_MS[type], recorded: false });
  }
}
