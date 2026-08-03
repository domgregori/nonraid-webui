// Mirrors backend/src/smart/types.ts. Keep in sync.

export type SelfTestType = 'short' | 'long' | 'conveyance';
export type SelfTestState = 'idle' | 'running' | 'passed' | 'failed' | 'aborted' | 'unknown';

export interface SelfTestStatus {
  state: SelfTestState;
  type: SelfTestType | null;
  progressPct: number | null;
  statusText: string | null;
}

export interface SelfTestHistoryEntry {
  type: string;
  status: string;
  passed: boolean | null;
  lifetimeHours: number | null;
}

export interface SmartAttributes {
  device: string;
  model: string | null;
  serial: string | null;
  capacityBytes: number | null;
  health: 'passed' | 'failed' | null;
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
