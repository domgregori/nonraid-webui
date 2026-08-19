export type SmartHealth = 'passed' | 'failed';

/** Live power state, from smartctl's -n standby exit-status bit - see realClient.ts's run(). */
export type SmartSpinState = 'active' | 'standby' | 'unknown';

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

/** One row of the raw ATA SMART attribute table (smartctl's `-a` output), same data most array-management webGUIs show on an "Attributes" tab. */
export interface SmartRawAttribute {
  id: number;
  name: string;
  /** e.g. "0x0032" - hex of the attribute's flags word. */
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

/** Drive/controller capability + self-test polling info, same data most array-management webGUIs show on a "Capabilities" tab. */
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
  /** World Wide Name - a real, stable hardware identifier smartctl reports (`smartctl -x`'s "Logical
   *  Unit id"), used as this app's "UUID" for array-assigned disks since nmdctl itself has none. */
  wwn: string | null;
  capacityBytes: number | null;
  health: SmartHealth | null;
  temperature: number | null;
  /** 0 or absent depending on the drive - see rotationRpm's own doc comment. Not itself a reliable
   *  SSD/HDD signal (some HDDs, like this project's own test WD Blue, don't report it at all); type
   *  detection uses lsblk's ROTA flag instead (system/diskType.ts). This is RPM-when-known only. */
  rotationRpm: number | null;
  spinState: SmartSpinState;
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
  /** Celsius, or null if unavailable (device asleep, permission denied, no temp sensor, etc). */
  getTemperature(device: string): Promise<number | null>;
  /** Overall SMART health self-assessment, or null if unavailable (device asleep, no SMART support, etc). */
  getHealth(device: string): Promise<SmartHealth | null>;
  /** Curated attribute/self-test snapshot, or null if the device has no SMART data available. */
  getAttributes(device: string): Promise<SmartAttributes | null>;
  /** Fire-and-forget: starts the test on the drive's own controller and returns once the trigger command completes. */
  startSelfTest(device: string, type: SelfTestType): Promise<void>;
}
