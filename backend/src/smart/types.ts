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

/** One row of the raw ATA SMART attribute table (smartctl's `-a` output), e.g. Unraid's "Attributes" tab. */
export interface SmartRawAttribute {
  id: number;
  name: string;
  /** e.g. "0x0032" — hex of the attribute's flags word. */
  flagHex: string | null;
  value: number | null;
  worst: number | null;
  threshold: number | null;
  type: 'Pre-fail' | 'Old age' | null;
  updated: 'Always' | 'Offline' | null;
  /** "Never", or the raw when_failed text (e.g. "FAILING_NOW"). */
  whenFailed: string;
  rawValue: number | null;
  rawString: string | null;
}

/** Drive/controller capability + self-test polling info, e.g. Unraid's "Capabilities" tab. */
export interface SmartCapabilitiesInfo {
  offlineDataCollectionStatus: string | null;
  offlineDataCollectionSeconds: number | null;
  selfTestExecutionStatus: string | null;
  shortSelfTestPollingMinutes: number | null;
  extendedSelfTestPollingMinutes: number | null;
  execOfflineImmediateSupported: boolean | null;
  offlineSurfaceScanSupported: boolean | null;
  selfTestSupported: boolean | null;
  conveyanceSelfTestSupported: boolean | null;
  selectiveSelfTestSupported: boolean | null;
  attributeAutosaveEnabled: boolean | null;
  errorLoggingSupported: boolean | null;
  generalPurposeLoggingSupported: boolean | null;
  sctStatusSupported: boolean | null;
}

/** Curated smartmontools detail, plus the raw attribute table and capabilities for the Disks tab's Attributes/Capabilities sub-views. */
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
  rawAttributes: SmartRawAttribute[];
  capabilitiesInfo: SmartCapabilitiesInfo;
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
