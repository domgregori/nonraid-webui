import type { NmdClient } from '../nmd/client.js';
import type { AddDiskResult, AvailableDevice, NmdCommandResult, NmdStatusResponse } from '../nmd/types.js';

/**
 * Realistic minimal fixtures mirroring nmdctl `status -o json` output: a small
 * running array with P parity on slot 0, data on slots 1-2, one missing slot.
 * Disks 1-2 report real absolute mountpoints so ShareService.buildContext()
 * picks them up; override getStatus() in tests that need different topology.
 */
export const nmdStatusFixture: NmdStatusResponse = {
  array: {
    label: 'TestArray',
    state: 'STARTED',
    superblock: '/etc/nonraid/super.dat',
    disks_present: 3,
    disks_imported: 3,
    disks_unassigned: 0,
    total_slots: 30,
    health: { status: 'HEALTHY', details: 'ok', code: 0 },
    size: { data_gb: 4000, data_disk_count: 2, has_parity: true, has_second_parity: false, parity_size_gb: 4000, second_parity_size_gb: 0 },
    counters: { missing: 0, invalid: 0, wrong: 0, disabled: 0, replaced: 0, new: 0, sync_errors: 0, disk_errors: 0 },
    last_sync: { timestamp: 0, age_seconds: 3600, elapsed_seconds: 7200, status: 'completed' },
  },
  resync: { active: false, paused: false, pending: false, action: 'idle', progress_percent: 0, position_gb: 0, size_gb: 0, rate_mb_s: 0, elapsed_seconds: 0, eta_seconds: 0 },
  disks: [
    {
      slot: 0,
      type: 'P',
      size_kb: 4000000000,
      size_gb: 4000,
      device: '/dev/sda',
      status: 'DISK_OK',
      errors: 0,
      reads: 0,
      writes: 0,
      disk_id: 'WDC_WD40EFRX_AAA111',
      disk_name: 'WDC WD40EFRX-68N32N0',
    },
    {
      slot: 1,
      type: 'data',
      size_kb: 4000000000,
      size_gb: 4000,
      device: '/dev/sdb',
      status: 'DISK_OK',
      errors: 0,
      reads: 0,
      writes: 0,
      disk_id: 'WDC_WD40EFRX_BBB222',
      disk_name: 'WDC WD40EFRX-68N32N0',
      filesystem: { type: 'xfs', mountpoint: '/mnt/disk1', usage: '0%' },
    },
    {
      slot: 2,
      type: 'data',
      size_kb: 4000000000,
      size_gb: 4000,
      device: '/dev/sdc',
      status: 'DISK_OK',
      errors: 0,
      reads: 0,
      writes: 0,
      disk_id: 'WDC_WD40EFRX_CCC333',
      disk_name: 'WDC WD40EFRX-68N32N0',
      filesystem: { type: 'xfs', mountpoint: '/mnt/disk2', usage: '0%' },
    },
  ],
};

export const nmdAvailableDevicesFixture: AvailableDevice[] = [
  {
    device: '/dev/sdd',
    partition: '/dev/sdd1',
    sizeKb: 2000000000,
    diskId: 'WDC_WD40EFRX_DDD444',
    model: 'WDC WD40EFRX-68N32N0',
    uuid: null,
    locked: false,
    isSSD: false,
  },
  {
    device: '/dev/sde',
    partition: null,
    sizeKb: 1000000000,
    diskId: 'KINGSTON_SA400S37_EEE555',
    model: 'KINGSTON SA400S37240G',
    uuid: null,
    locked: false,
    isSSD: true,
  },
];

export const nmdOkResult: NmdCommandResult = { ok: true, message: 'ok' };

const defaults = {
  getStatus: async (): Promise<NmdStatusResponse> => structuredClone(nmdStatusFixture),
  startArray: async (): Promise<NmdCommandResult> => ({ ...nmdOkResult, message: 'Array started' }),
  stopArray: async (): Promise<NmdCommandResult> => ({ ...nmdOkResult, message: 'Array stopped' }),
  unmountDisks: async (): Promise<NmdCommandResult> => ({ ...nmdOkResult, message: 'Disks unmounted' }),
  mountDisks: async (): Promise<NmdCommandResult> => ({ ...nmdOkResult, message: 'Disks mounted' }),
  listAvailableDevices: async (): Promise<AvailableDevice[]> => structuredClone(nmdAvailableDevicesFixture),
  scanAllDisks: async (): Promise<AvailableDevice[]> => structuredClone(nmdAvailableDevicesFixture),
  addDisk: async (slot: number, device: string): Promise<AddDiskResult> => ({ slot, message: `Added ${device} to slot ${slot}`, output: '' }),
  replaceDisk: async (slot: number, device: string): Promise<AddDiskResult> => ({ slot, message: `Replaced slot ${slot} with ${device}`, output: '' }),
  restoreUnassignedDisk: async (slot: number): Promise<NmdCommandResult> => ({ ...nmdOkResult, message: `Restored slot ${slot}` }),
  formatDisk: async (slot: number): Promise<NmdCommandResult> => ({ ...nmdOkResult, message: `Formatted slot ${slot}` }),
  parityCheck: async (): Promise<NmdCommandResult> => ({ ...nmdOkResult, message: 'Parity check started' }),
  unassignDisk: async (slot: number): Promise<NmdCommandResult> => ({ ...nmdOkResult, message: `Unassigned slot ${slot}` }),
  shrinkArray: async (dropSlots: number[]): Promise<NmdCommandResult> => ({ ...nmdOkResult, message: `Shrunk slots ${dropSlots.join(', ')}` }),
  reloadDriver: async (): Promise<NmdCommandResult> => ({ ...nmdOkResult, message: 'Driver reloaded' }),
  commitImportedSuperblock: async (stagedFilePath: string) => ({
    result: { importedCount: 3, sizeMismatches: [], errors: [], output: '' },
    targetPath: '/etc/nonraid/super.dat',
    backedUpTo: `${stagedFilePath}.bak`,
  }),
  getSuperblockPath: async (): Promise<string> => '/etc/nonraid/super.dat',
  reloadModuleAndImport: async () => ({ importedCount: 3, sizeMismatches: [], errors: [], output: '' }),
  setWriteMethod: async (turbo: boolean): Promise<NmdCommandResult> => ({ ...nmdOkResult, message: `Write method set to ${turbo ? 'turbo' : 'normal'}` }),
  setLabel: async (label: string): Promise<NmdCommandResult> => ({ ...nmdOkResult, message: `Label set to ${label}` }),
} satisfies NmdClient;

/** Builds an in-memory NmdClient fake; pass overrides to customize one method per test. */
export function createFakeNmdClient(overrides: Partial<NmdClient> = {}): NmdClient {
  return { ...defaults, ...overrides };
}
