export type SmartHealth = 'passed' | 'failed';

export type SelfTestType = 'short' | 'long' | 'conveyance';
export type SelfTestState = 'idle' | 'running' | 'passed' | 'failed' | 'aborted' | 'unknown';

export interface SelfTestStatus {
  state: SelfTestState;
  type: SelfTestType | null;
  /** 0-100 while running, null when not running or unknown. */
  progressPct: number | null;
  statusText: string | null;
}

export interface SelfTestHistoryEntry {
  type: string;
  status: string;
  passed: boolean | null;
  lifetimeHours: number | null;
}

/** Curated smartmontools detail — not the raw ATA attribute table, see the Disks tab handoff's design decision. */
export interface SmartAttributes {
  device: string;
  model: string | null;
  serial: string | null;
  capacityBytes: number | null;
  health: SmartHealth | null;
  temperature: number | null;
  powerOnHours: number | null;
  powerCycleCount: number | null;
  reallocatedSectors: number | null;
  pendingSectors: number | null;
  uncorrectableSectors: number | null;
  selfTest: SelfTestStatus;
  selfTestHistory: SelfTestHistoryEntry[];
  capabilities: { short: boolean; long: boolean; conveyance: boolean };
}

export interface SmartClient {
  readonly mode: 'real' | 'mock';
  /** Celsius, or null if unavailable (device asleep, permission denied, no temp sensor, etc). */
  getTemperature(device: string): Promise<number | null>;
  /** Overall SMART health self-assessment, or null if unavailable (device asleep, no SMART support, etc). */
  getHealth(device: string): Promise<SmartHealth | null>;
  /** Curated attribute/self-test snapshot, or null if the device has no SMART data available. */
  getAttributes(device: string): Promise<SmartAttributes | null>;
  /** Fire-and-forget: starts the test on the drive's own controller and returns once the trigger command completes. */
  startSelfTest(device: string, type: SelfTestType): Promise<void>;
}
