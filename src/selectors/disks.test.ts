import { describe, it, expect } from 'vitest';
import { diskNeedsFormat, deriveDisk, deriveDisks, deriveCapacity, deriveDisksOnline } from './disks';
import { COLORS } from '../styles/colors';
import type { NmdDisk, NmdStatusResponse } from '../types/nmdApi';
import type { DiskViewModel } from '../types';

function makeDisk(overrides: Partial<NmdDisk> = {}): NmdDisk {
  return {
    slot: 1,
    type: 'data',
    size_kb: 1024 * 1024 * 1024,
    size_gb: 1024,
    device: '/dev/sda',
    status: 'DISK_OK',
    errors: 0,
    reads: 0,
    writes: 0,
    disk_id: 'id-1',
    disk_name: 'Disk 1',
    ...overrides,
  };
}

function makeStatus(overrides: { state?: NmdStatusResponse['array']['state']; disks?: NmdDisk[] } = {}): NmdStatusResponse {
  return {
    array: {
      label: 'Test Array',
      state: overrides.state ?? 'STARTED',
      superblock: 'sb',
      disks_present: 1,
      disks_imported: 1,
      disks_unassigned: 0,
      total_slots: 2,
      health: { status: 'HEALTHY', details: '', code: 0 },
      size: {
        data_gb: 1024,
        data_disk_count: 1,
        has_parity: true,
        has_second_parity: false,
        parity_size_gb: 1024,
        second_parity_size_gb: 0,
      },
      counters: {
        missing: 0,
        invalid: 0,
        wrong: 0,
        disabled: 0,
        replaced: 0,
        new: 0,
        sync_errors: 0,
        disk_errors: 0,
      },
      last_sync: { timestamp: 0, age_seconds: 0, elapsed_seconds: 0, status: '' },
    },
    resync: {
      active: false,
      paused: false,
      pending: false,
      action: '',
      progress_percent: 0,
      position_gb: 0,
      size_gb: 0,
      rate_mb_s: 0,
      elapsed_seconds: 0,
      eta_seconds: 0,
    },
    disks: overrides.disks ?? [makeDisk()],
  };
}

describe('diskNeedsFormat', () => {
  const cases: [Partial<NmdDisk>, boolean][] = [
    [{ type: 'data', status: 'DISK_OK', filesystem: { type: 'ext4', mountpoint: '/mnt/disk1', usage: '50%' } }, false],
    [{ type: 'data', status: 'DISK_OK', filesystem: { type: 'xfs', mountpoint: '/mnt/disk1', usage: '10%' } }, false],
    [{ type: 'data', status: 'DISK_OK', filesystem: { type: 'unknown', mountpoint: '-', usage: '' } }, true],
    [{ type: 'data', status: 'DISK_OK', filesystem: undefined }, true],
    [{ type: 'data', status: 'DISK_OK' }, true], // no filesystem key at all
    [{ type: 'data', status: 'DISK_OK', filesystem: { type: '', mountpoint: '', usage: '' } }, true], // empty string is falsy
    [{ type: 'P', status: 'DISK_OK', filesystem: undefined }, false], // parity never needs a filesystem
    [{ type: 'Q', status: 'DISK_OK', filesystem: undefined }, false],
    [{ type: 'data', status: 'DISK_NP_MISSING', filesystem: undefined }, false], // not OK -> not "needs format"
    [{ type: 'data', status: 'DISK_INVALID', filesystem: undefined }, false],
    [{ type: 'data', status: 'DISK_NEW', filesystem: undefined }, false],
  ];
  it.each(cases)('diskNeedsFormat(%o) -> %s', (overrides, expected) => {
    expect(diskNeedsFormat(makeDisk(overrides))).toBe(expected);
  });
});

describe('deriveDisk', () => {
  it('reports standby when the array is stopped, regardless of disk state or filesystem', () => {
    const vm = deriveDisk(makeDisk({ status: 'DISK_OK', filesystem: undefined }), false, undefined, null, null, null, {});
    expect(vm.status).toBe('standby');
    expect(vm.statusLabel).toBe('Standby');
    expect(vm.statusColor).toBe(COLORS.textDim);
    expect(vm.borderColor).toBe(COLORS.border);
    expect(vm.needsFormat).toBe(false); // filesystem info is untrustworthy while stopped
  });

  it('derives an active healthy disk', () => {
    const vm = deriveDisk(
      makeDisk({
        slot: 1,
        status: 'DISK_OK',
        filesystem: { type: 'ext4', mountpoint: '/mnt/disk1', usage: '45%' },
      }),
      true,
      38,
      'passed',
      false, null, {}
    );
    expect(vm.status).toBe('active');
    expect(vm.statusLabel).toBe('Active');
    expect(vm.statusColor).toBe(COLORS.green);
    expect(vm.borderColor).toBe(COLORS.green);
    expect(vm.needsFormat).toBe(false);
    expect(vm.usedPct).toBe(45);
    expect(vm.usedLabel).toBe('45%');
    expect(vm.fsType).toBe('EXT4');
    expect(vm.mountpoint).toBe('/mnt/disk1');
  });

  it('marks a started, unformatted DISK_OK data disk as needsFormat', () => {
    const vm = deriveDisk(makeDisk({ status: 'DISK_OK', filesystem: undefined }), true, undefined, null, null, null, {});
    expect(vm.status).toBe('active');
    expect(vm.needsFormat).toBe(true);
    expect(vm.borderColor).toBe(COLORS.amber); // amber border signals "needs attention"
    expect(vm.fsType).toBe('-');
    expect(vm.usedLabel).toBe('0%');
  });

  it('normalizes an "unknown" filesystem type to needsFormat', () => {
    const vm = deriveDisk(
      makeDisk({ status: 'DISK_OK', filesystem: { type: 'unknown', mountpoint: '-', usage: '' } }),
      true,
      undefined,
      null,
      null, null, {}
    );
    expect(vm.needsFormat).toBe(true);
  });

  it.each([
    ['DISK_NP_MISSING', 'Missing · Emulated'],
    ['DISK_WRONG', 'Wrong Disk'],
    ['DISK_INVALID', 'Invalid'],
    ['DISK_DSBL', 'Disabled'],
    ['DISK_NP_DSBL', 'Disabled'],
    ['DISK_NEW', 'New'],
    ['DISK_DSBL_NEW', 'New (Disabled)'],
  ] as const)('maps raw status %s to label %s', (rawStatus, expectedLabel) => {
    const vm = deriveDisk(makeDisk({ status: rawStatus }), true, undefined, null, null, null, {});
    expect(vm.status).toBe('missing');
    expect(vm.statusLabel).toBe(expectedLabel);
    expect(vm.statusColor).toBe(COLORS.red);
    expect(vm.borderColor).toBe(COLORS.red);
    expect(vm.rawStatus).toBe(rawStatus);
  });

  it('falls back to the raw status string for unknown statuses', () => {
    const vm = deriveDisk(makeDisk({ status: 'DISK_FOO' }), true, undefined, null, null, null, {});
    expect(vm.statusLabel).toBe('DISK_FOO');
  });

  it('derives parity disks with fixed labels and no usage', () => {
    const p = deriveDisk(makeDisk({ slot: 1, type: 'P', status: 'DISK_OK' }), true, undefined, null, null, null, {});
    expect(p.role).toBe('parity');
    expect(p.label).toBe('Parity 1');
    expect(p.usedPct).toBe(0);
    expect(p.usedLabel).toBe('-');
    expect(p.fsType).toBe('-');
    expect(p.mountpoint).toBe('-');
    expect(p.barWidth).toBe('0%');

    const q = deriveDisk(makeDisk({ slot: 1, type: 'Q', status: 'DISK_OK' }), true, undefined, null, null, null, {});
    expect(q.label).toBe('Parity 2');
  });

  it('copies identity fields through', () => {
    const vm = deriveDisk(
      makeDisk({ slot: 7, device: '/dev/sdg', status: 'DISK_OK', filesystem: { type: 'btrfs', mountpoint: '/mnt/disk7', usage: '12%' } }),
      true,
      undefined,
      null,
      null, null, {}
    );
    expect(vm.id).toBe('7');
    expect(vm.slot).toBe(7);
    expect(vm.device).toBe('/dev/sdg');
    expect(vm.label).toBe('Disk 7');
    expect(vm.role).toBe('data');
  });

  it.each([
    [512, '512 GB'],
    [10, '10 GB'],
    [9.5, '9.5 GB'], // sub-10 GB keeps a decimal
    [0.5, '0.5 GB'], // tiny test disks
    [1024, '1 TB'],
    [1536, '1.5 TB'],
    [2048, '2 TB'],
  ] as const)('formats sizeLabel for size_gb=%d as %s', (sizeGb, expected) => {
    const vm = deriveDisk(makeDisk({ status: 'DISK_OK', size_gb: sizeGb, filesystem: undefined }), true, undefined, null, null, null, {});
    expect(vm.sizeLabel).toBe(expected);
  });

  it('parses usage percentage out of the raw usage string', () => {
    const vm = deriveDisk(
      makeDisk({ status: 'DISK_OK', filesystem: { type: 'ext4', mountpoint: '/mnt/disk1', usage: '87%' } }),
      true,
      undefined,
      null,
      null, null, {}
    );
    expect(vm.usedPct).toBe(87);
    expect(vm.barWidth).toBe('87%');
  });

  it('treats unparseable usage as 0%', () => {
    const vm = deriveDisk(
      makeDisk({ status: 'DISK_OK', filesystem: { type: 'ext4', mountpoint: '/mnt/disk1', usage: 'abc' } }),
      true,
      undefined,
      null,
      null, null, {}
    );
    expect(vm.usedPct).toBe(0);
    expect(vm.usedLabel).toBe('0%');
  });

  it.each([
    [0, COLORS.blue],
    [74, COLORS.blue],
    [75, COLORS.amber],
    [89, COLORS.amber],
    [90, COLORS.red],
    [100, COLORS.red],
  ] as const)('colors the bar by usage pct %d', (usedPct, expected) => {
    const vm = deriveDisk(
      makeDisk({ status: 'DISK_OK', filesystem: { type: 'ext4', mountpoint: '/mnt/disk1', usage: `${usedPct}%` } }),
      true,
      undefined,
      null,
      null, null, {}
    );
    expect(vm.barColor).toBe(expected);
  });

  it.each([
    [undefined, 0, '-', COLORS.textSecondary],
    [39.4, 39.4, '39°C', COLORS.textSecondary], // temp keeps the raw value; label rounds
    [40, 40, '40°C', COLORS.amber], // 40 is the amber threshold
    [51.6, 51.6, '52°C', COLORS.amber], // label rounds 51.6 up to 52
  ] as const)('derives temp with tempC=%s', (tempC, expectedTemp, expectedLabel, expectedColor) => {
    const vm = deriveDisk(makeDisk({ status: 'DISK_OK', filesystem: undefined }), true, tempC, null, null, null, {});
    expect(vm.temp).toBe(expectedTemp);
    expect(vm.tempLabel).toBe(expectedLabel);
    expect(vm.tempColor).toBe(expectedColor);
  });

  it.each([
    [undefined, null, 'SMART -', COLORS.textDim],
    [null, null, 'SMART -', COLORS.textDim],
    ['passed', 'passed', 'SMART OK', COLORS.green],
    ['failed', 'failed', 'SMART Failing', COLORS.red],
  ] as const)('derives SMART health from health=%s', (health, expectedHealth, expectedLabel, expectedColor) => {
    const vm = deriveDisk(makeDisk({ status: 'DISK_OK', filesystem: undefined }), true, undefined, health, null, null, {});
    expect(vm.health).toBe(expectedHealth);
    expect(vm.healthLabel).toBe(expectedLabel);
    expect(vm.healthColor).toBe(expectedColor);
  });

  it.each([
    [undefined, null, '-'],
    [null, null, '-'],
    [true, true, 'SSD'],
    [false, false, 'HDD'],
  ] as const)('derives drive type from isSSD=%s', (isSSD, expectedIsSSD, expectedLabel) => {
    const vm = deriveDisk(makeDisk({ status: 'DISK_OK', filesystem: undefined }), true, undefined, null, isSSD, null, {});
    expect(vm.isSSD).toBe(expectedIsSSD);
    expect(vm.typeLabel).toBe(expectedLabel);
  });

  it('normalizes a "-" mountpoint to "-"', () => {
    const vm = deriveDisk(
      makeDisk({ status: 'DISK_OK', filesystem: { type: 'ext4', mountpoint: '-', usage: '0%' } }),
      true,
      undefined,
      null,
      null, null, {}
    );
    expect(vm.mountpoint).toBe('-');
  });
});

describe('deriveDisks', () => {
  it('sorts by slot and splits parity from data', () => {
    const status = makeStatus({
      disks: [
        makeDisk({ slot: 3, device: '/dev/sdc', status: 'DISK_OK', filesystem: { type: 'xfs', mountpoint: '/mnt/disk3', usage: '30%' } }),
        makeDisk({ slot: 1, device: '/dev/sda', status: 'DISK_OK', filesystem: { type: 'ext4', mountpoint: '/mnt/disk1', usage: '50%' } }),
        makeDisk({ slot: 2, device: '/dev/sdb', type: 'P', status: 'DISK_OK' }),
      ],
    });
    const result = deriveDisks(status, { '/dev/sda': 41, '/dev/sdc': null });
    expect(result.all.map((d) => d.slot)).toEqual([1, 2, 3]);
    expect(result.parity.map((d) => d.slot)).toEqual([2]);
    expect(result.data.map((d) => d.slot)).toEqual([1, 3]);
  });

  it('keys temps, healths, and types off the device name', () => {
    const status = makeStatus({
      disks: [
        makeDisk({ slot: 1, device: '/dev/sda', status: 'DISK_OK', filesystem: { type: 'ext4', mountpoint: '/mnt/disk1', usage: '50%' } }),
        makeDisk({ slot: 2, device: '/dev/sdb', status: 'DISK_OK', filesystem: { type: 'xfs', mountpoint: '/mnt/disk2', usage: '30%' } }),
      ],
    });
    const result = deriveDisks(
      status,
      { '/dev/sda': 41 },
      { '/dev/sda': 'failed' },
      { '/dev/sda': true },
    );
    const sda = result.data[0];
    const sdb = result.data[1];
    expect(sda.temp).toBe(41);
    expect(sda.health).toBe('failed');
    expect(sda.typeLabel).toBe('SSD');
    // unkeyed disk gets defaults
    expect(sdb.temp).toBe(0);
    expect(sdb.health).toBe(null);
    expect(sdb.typeLabel).toBe('-');
  });

  it('reports every disk standby when the array is stopped', () => {
    const result = deriveDisks(makeStatus({ state: 'STOPPED', disks: [makeDisk(), makeDisk({ slot: 2 })] }), {});
    expect(result.all.every((d) => d.status === 'standby')).toBe(true);
  });

  it('returns empty partitions for an empty disk list', () => {
    const result = deriveDisks(makeStatus({ disks: [] }), {});
    expect(result.all).toEqual([]);
    expect(result.parity).toEqual([]);
    expect(result.data).toEqual([]);
  });
});

describe('deriveCapacity', () => {
  it('returns zeroed labels for no data disks', () => {
    const result = deriveCapacity([], true);
    expect(result.usedLabel).toBe('0.0 GB');
    expect(result.totalLabel).toBe('0.0 GB');
    expect(result.freeLabel).toBe('0.0 GB');
    expect(result.pct).toBe(0);
  });

  it('derives pct and TB labels from a single disk', () => {
    const disks: DiskViewModel[] = [deriveDisk(makeDisk({ status: 'DISK_OK', size_gb: 1024, filesystem: { type: 'ext4', mountpoint: '/mnt/disk1', usage: '50%' } }), true, undefined, null, null, null, {})];
    const result = deriveCapacity(disks, true);
    expect(result.pct).toBe(50);
    expect(result.totalLabel).toBe('1 TB');
    expect(result.usedLabel).toBe('512 GB');
    expect(result.freeLabel).toBe('512 GB');
  });

  it('returns pct 0 when the array is not started', () => {
    const disks: DiskViewModel[] = [deriveDisk(makeDisk({ status: 'DISK_OK', size_gb: 1024, filesystem: { type: 'ext4', mountpoint: '/mnt/disk1', usage: '50%' } }), true, undefined, null, null, null, {})];
    expect(deriveCapacity(disks, false).pct).toBe(0);
  });

  it('weights usage across multiple disks', () => {
    const disks: DiskViewModel[] = [
      deriveDisk(makeDisk({ slot: 1, status: 'DISK_OK', size_gb: 1024, filesystem: { type: 'ext4', mountpoint: '/mnt/disk1', usage: '100%' } }), true, undefined, null, null, null, {}),
      deriveDisk(makeDisk({ slot: 2, status: 'DISK_OK', size_gb: 1024, filesystem: { type: 'ext4', mountpoint: '/mnt/disk2', usage: '0%' } }), true, undefined, null, null, null, {}),
    ];
    const result = deriveCapacity(disks, true);
    expect(result.totalLabel).toBe('2 TB');
    expect(result.usedLabel).toBe('1 TB');
    expect(result.freeLabel).toBe('1 TB');
    expect(result.pct).toBe(50);
  });

  it('handles small test disks without rounding to 0', () => {
    const disks: DiskViewModel[] = [deriveDisk(makeDisk({ status: 'DISK_OK', size_gb: 5, filesystem: { type: 'ext4', mountpoint: '/mnt/disk1', usage: '50%' } }), true, undefined, null, null, null, {})];
    const result = deriveCapacity(disks, true);
    expect(result.totalLabel).toBe('5.0 GB'); // sub-10 GB keeps a decimal in formatSize
    expect(result.usedLabel).toBe('2.5 GB');
    expect(result.freeLabel).toBe('2.5 GB');
    expect(result.pct).toBe(50);
  });

  it('rounds fractional pct to the nearest integer', () => {
    const disks: DiskViewModel[] = [
      deriveDisk(makeDisk({ slot: 1, status: 'DISK_OK', size_gb: 1024, filesystem: { type: 'ext4', mountpoint: '/mnt/disk1', usage: '33%' } }), true, undefined, null, null, null, {}),
      deriveDisk(makeDisk({ slot: 2, status: 'DISK_OK', size_gb: 1024, filesystem: { type: 'ext4', mountpoint: '/mnt/disk2', usage: '33%' } }), true, undefined, null, null, null, {}),
      deriveDisk(makeDisk({ slot: 3, status: 'DISK_OK', size_gb: 1024, filesystem: { type: 'ext4', mountpoint: '/mnt/disk3', usage: '33%' } }), true, undefined, null, null, null, {}),
    ];
    expect(deriveCapacity(disks, true).pct).toBe(33);
  });
});

describe('deriveDisksOnline', () => {
  it('counts only active disks', () => {
    const disks: DiskViewModel[] = [
      deriveDisk(makeDisk({ slot: 1, status: 'DISK_OK', filesystem: { type: 'ext4', mountpoint: '/mnt/disk1', usage: '10%' } }), true, undefined, null, null, null, {}),
      deriveDisk(makeDisk({ slot: 2, status: 'DISK_NP_MISSING' }), true, undefined, null, null, null, {}),
      deriveDisk(makeDisk({ slot: 3, status: 'DISK_OK', filesystem: { type: 'ext4', mountpoint: '/mnt/disk3', usage: '10%' } }), true, undefined, null, null, null, {}),
    ];
    expect(deriveDisksOnline(disks)).toBe(2);
  });

  it('counts standby disks as offline', () => {
    const disks: DiskViewModel[] = [deriveDisk(makeDisk(), false, undefined, null, null, null, {})];
    expect(deriveDisksOnline(disks)).toBe(0);
  });

  it('returns 0 for an empty list', () => {
    expect(deriveDisksOnline([])).toBe(0);
  });
});
