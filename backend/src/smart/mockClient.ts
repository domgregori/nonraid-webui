import { mockDeviceTemps } from '../nmd/mockData.js';
import type {
  SelfTestHistoryEntry,
  SelfTestStatus,
  SelfTestType,
  SmartAttributes,
  SmartCapabilitiesInfo,
  SmartClient,
  SmartHealth,
  SmartRawAttribute,
} from './types.js';

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

/** Same attribute IDs/names as a real SATA SSD dump (see realClient.ts's doc comment) — plausible raw values, all healthy. */
function buildRawAttributes(temperature: number, powerOnHours: number, powerCycleCount: number, hash: number): SmartRawAttribute[] {
  const row = (id: number, name: string, rawValue: number, prefailure = false, updatedOnline = true): SmartRawAttribute => ({
    id,
    name,
    flagHex: `0x00${(prefailure ? 51 : 50).toString(16)}`,
    value: 100,
    worst: 100,
    threshold: 50,
    type: prefailure ? 'Pre-fail' : 'Old age',
    updated: updatedOnline ? 'Always' : 'Offline',
    whenFailed: 'Never',
    rawValue,
    rawString: String(rawValue),
  });
  return [
    row(1, 'Raw_Read_Error_Rate', 0),
    row(5, 'Reallocated_Sector_Ct', 0),
    row(9, 'Power_On_Hours', powerOnHours),
    row(12, 'Power_Cycle_Count', powerCycleCount),
    row(160, 'Unknown_Attribute', 0),
    row(161, 'Unknown_Attribute', hash % 100, true),
    row(163, 'Unknown_Attribute', hash % 30),
    row(164, 'Unknown_Attribute', hash % 50_000),
    row(165, 'Unknown_Attribute', hash % 100),
    row(166, 'Unknown_Attribute', hash % 10),
    row(167, 'Unknown_Attribute', hash % 20),
    row(168, 'Unknown_Attribute', hash % 6_000),
    row(169, 'Unknown_Attribute', 100),
    row(175, 'Program_Fail_Count_Chip', 0),
    row(176, 'Erase_Fail_Count_Chip', 0),
    row(177, 'Wear_Leveling_Count', 0),
    row(178, 'Used_Rsvd_Blk_Cnt_Chip', 0),
    row(181, 'Program_Fail_Cnt_Total', 0),
    row(182, 'Erase_Fail_Count_Total', 0),
    row(192, 'Power-Off_Retract_Count', hash % 100),
    row(194, 'Temperature_Celsius', Math.round(temperature)),
    row(195, 'Hardware_ECC_Recovered', 0),
    row(196, 'Reallocated_Event_Count', 0),
    row(197, 'Current_Pending_Sector', 0),
    row(198, 'Offline_Uncorrectable', 0),
    row(199, 'UDMA_CRC_Error_Count', 0),
    row(232, 'Available_Reservd_Space', 100),
    row(241, 'Total_LBAs_Written', hash % 100_000, false, false),
    row(242, 'Total_LBAs_Read', hash % 1_000_000, false, false),
  ];
}

/** conveyanceSupported/attributeAutosave vary per device (hash-derived) so the UI's capability-gating is actually exercised in mock mode. */
function buildCapabilitiesInfo(conveyanceSupported: boolean, hash: number): SmartCapabilitiesInfo {
  return {
    offlineDataCollectionStatus: 'was never started',
    offlineDataCollectionSeconds: 120,
    selfTestExecutionStatus: 'completed without error',
    shortSelfTestPollingMinutes: 2,
    extendedSelfTestPollingMinutes: 10,
    execOfflineImmediateSupported: true,
    offlineSurfaceScanSupported: false,
    selfTestSupported: true,
    conveyanceSelfTestSupported: conveyanceSupported,
    selectiveSelfTestSupported: false,
    attributeAutosaveEnabled: hash % 3 === 0,
    errorLoggingSupported: true,
    generalPurposeLoggingSupported: true,
    sctStatusSupported: true,
  };
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
    const hash = hashDevice(device);
    const temperature = Math.round((base + (Math.random() * 2 - 1)) * 10) / 10;
    const powerOnHours = 8760 + Math.floor(base * 10);
    const powerCycleCount = 42;
    // ~2/3 of real SATA SSDs skip conveyance support (it's an HDD-shipping-damage check) — see realClient.ts's doc comment for the real drive that motivated this.
    const conveyanceSupported = hash % 3 === 0;

    return {
      device,
      model: 'Mock Drive',
      serial: `MOCK-${device.replace(/\W+/g, '-')}`,
      capacityBytes: null,
      health: 'passed',
      temperature,
      powerOnHours,
      powerCycleCount,
      reallocatedSectors: 0,
      pendingSectors: 0,
      uncorrectableSectors: 0,
      selfTest: this.currentSelfTest(device),
      selfTestHistory: this.history.get(device) ?? [],
      capabilities: { short: true, long: true, conveyance: conveyanceSupported },
      rawAttributes: buildRawAttributes(temperature, powerOnHours, powerCycleCount, hash),
      capabilitiesInfo: buildCapabilitiesInfo(conveyanceSupported, hash),
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
