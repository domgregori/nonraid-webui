import type { SelfTestType, SmartAttributes, SmartClient, SmartHealth } from '../smart/types.js';

/**
 * Realistic minimal SMART snapshot for one device. Structured-cloned per
 * getAttributes() call so tests can't accidentally share/mutate one instance.
 */
export const smartAttributesFixture: SmartAttributes = {
  device: '/dev/sdb',
  model: 'WDC WD40EFRX-68N32N0',
  serial: 'WD-WCC7K3ABCDEF',
  wwn: '0x50014ee2abcdef00',
  capacityBytes: 4000787030016,
  health: 'passed',
  temperature: 38,
  rotationRpm: 5400,
  spinState: 'active',
  powerOnHours: 12345,
  powerCycleCount: 87,
  reallocatedSectors: 0,
  pendingSectors: 0,
  uncorrectableSectors: 0,
  selfTest: { state: 'idle', type: null, progressPct: null, statusText: null },
  selfTestHistory: [],
  capabilities: { short: true, long: true, conveyance: true },
  rawAttributes: [],
  capabilitiesInfo: {
    offlineDataCollectionStatus: 'completed',
    offlineDataCollectionSeconds: 125,
    selfTestExecutionStatus: 'completed',
    shortSelfTestPollingMinutes: 2,
    extendedSelfTestPollingMinutes: 254,
    execOfflineImmediateSupported: true,
    offlineSurfaceScanSupported: true,
    selfTestSupported: true,
    conveyanceSelfTestSupported: true,
    selectiveSelfTestSupported: true,
    attributeAutosaveEnabled: true,
    errorLoggingSupported: true,
    generalPurposeLoggingSupported: true,
    sctStatusSupported: true,
  },
};

const defaults = {
  getTemperature: async (_device: string): Promise<number | null> => 38,
  getHealth: async (_device: string): Promise<SmartHealth | null> => 'passed',
  getAttributes: async (_device: string): Promise<SmartAttributes | null> => structuredClone(smartAttributesFixture),
  startSelfTest: async (_device: string, _type: SelfTestType): Promise<void> => {},
} satisfies SmartClient;

/** Builds an in-memory SmartClient fake; pass overrides to customize one method per test. */
export function createFakeSmartClient(overrides: Partial<SmartClient> = {}): SmartClient {
  return { ...defaults, ...overrides };
}
