import { describe, it, expect } from 'vitest';
import {
  deriveArrayStatus,
  deriveDegradedReasons,
  deriveProtection,
  deriveToggleButton,
  isArrayError,
  isDegraded,
} from './status';
import { COLORS, tint } from '../styles/colors';
import type {
  NmdArrayCounters,
  NmdArraySize,
  NmdDisk,
  NmdResyncStatus,
  NmdStatusResponse,
} from '../types/nmdApi';

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

function makeStatus(
  overrides: {
    state?: NmdStatusResponse['array']['state'];
    healthStatus?: NmdStatusResponse['array']['health']['status'];
    healthDetails?: string;
    counters?: Partial<NmdArrayCounters>;
    size?: Partial<NmdArraySize>;
    resync?: Partial<NmdResyncStatus>;
    disks?: NmdDisk[];
  } = {},
): NmdStatusResponse {
  return {
    array: {
      label: 'Test Array',
      state: overrides.state ?? 'STARTED',
      superblock: 'sb',
      disks_present: 1,
      disks_imported: 1,
      disks_unassigned: 0,
      total_slots: 2,
      health: {
        status: overrides.healthStatus ?? 'HEALTHY',
        details: overrides.healthDetails ?? '',
        code: 0,
      },
      size: {
        data_gb: 1024,
        data_disk_count: 1,
        has_parity: true,
        has_second_parity: false,
        parity_size_gb: 1024,
        second_parity_size_gb: 0,
        ...overrides.size,
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
        ...overrides.counters,
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
      ...overrides.resync,
    },
    disks: overrides.disks ?? [makeDisk()],
  };
}

describe('isDegraded', () => {
  it('returns false when the driver health status is not DEGRADED, even with a bad disk', () => {
    const status = makeStatus({
      healthStatus: 'HEALTHY',
      disks: [makeDisk({ status: 'DISK_NP_MISSING' })],
    });
    expect(isDegraded(status)).toBe(false);
  });

  it('returns false for the phantom-degraded glitch: every disk DISK_OK, zero errors, zero sync errors', () => {
    // Stale aggregate counters claim DEGRADED, but no per-disk or sync problem exists.
    const status = makeStatus({
      healthStatus: 'DEGRADED',
      counters: { missing: 1, invalid: 1 }, // stale counters the heuristic ignores
      disks: [
        makeDisk({ slot: 1, status: 'DISK_OK', errors: 0 }),
        makeDisk({ slot: 2, status: 'DISK_OK', errors: 0, type: 'P' }),
      ],
    });
    expect(isDegraded(status)).toBe(false);
  });

  it('returns false for an empty disk list with no sync errors', () => {
    const status = makeStatus({ healthStatus: 'DEGRADED', disks: [] });
    expect(isDegraded(status)).toBe(false);
  });

  it('returns true when a disk is genuinely missing', () => {
    const status = makeStatus({
      healthStatus: 'DEGRADED',
      disks: [makeDisk({ status: 'DISK_NP_MISSING' })],
    });
    expect(isDegraded(status)).toBe(true);
  });

  it('returns true when a DISK_OK disk has logged I/O errors', () => {
    const status = makeStatus({
      healthStatus: 'DEGRADED',
      disks: [makeDisk({ status: 'DISK_OK', errors: 3 })],
    });
    expect(isDegraded(status)).toBe(true);
  });

  it('returns true when sync_errors indicate a parity mismatch, all disks otherwise fine', () => {
    const status = makeStatus({
      healthStatus: 'DEGRADED',
      counters: { sync_errors: 4 },
      disks: [makeDisk({ status: 'DISK_OK', errors: 0 })],
    });
    expect(isDegraded(status)).toBe(true);
  });

  it('returns true for an empty disk list when sync_errors exist', () => {
    const status = makeStatus({ healthStatus: 'DEGRADED', counters: { sync_errors: 1 }, disks: [] });
    expect(isDegraded(status)).toBe(true);
  });
});

describe('isArrayError', () => {
  const cases: [string, boolean][] = [
    ['STARTED', false],
    ['STOPPED', false],
    ['NEW_ARRAY', false],
    ['RECON_DISK', false],
    ['ERROR:TOO_MANY_MISSING_DISKS', true],
    ['ERROR:INVALID_EXPANSION', true],
    ['ERROR:PARITY_NOT_BIGGEST', true],
    ['ERROR:NO_DATA_DISKS', true],
    ['ERROR:', true],
  ];
  it.each(cases)('isArrayError(state=%s) -> %s', (state, expected) => {
    expect(isArrayError(makeStatus({ state }))).toBe(expected);
  });
});

describe('deriveArrayStatus', () => {
  it('returns LOADING for a null status', () => {
    expect(deriveArrayStatus(null)).toEqual({
      text: 'LOADING',
      color: COLORS.textDim,
      pillBg: tint(COLORS.textDim, 14),
    });
  });

  it('returns ERROR for a driver ERROR: state', () => {
    const result = deriveArrayStatus(makeStatus({ state: 'ERROR:NO_DATA_DISKS' }));
    expect(result.text).toBe('ERROR');
    expect(result.color).toBe(COLORS.red);
  });

  it('returns STOPPED when the array is not started', () => {
    const result = deriveArrayStatus(makeStatus({ state: 'STOPPED' }));
    expect(result.text).toBe('STOPPED');
    expect(result.color).toBe(COLORS.textDim);
  });

  it('returns STOPPED for NEW_ARRAY and other non-STARTED states', () => {
    expect(deriveArrayStatus(makeStatus({ state: 'NEW_ARRAY' })).text).toBe('STOPPED');
    expect(deriveArrayStatus(makeStatus({ state: 'DISABLE_DISK' })).text).toBe('STOPPED');
  });

  it('returns DEGRADED for a real degradation', () => {
    const result = deriveArrayStatus(
      makeStatus({ healthStatus: 'DEGRADED', disks: [makeDisk({ status: 'DISK_NP_MISSING' })] }),
    );
    expect(result.text).toBe('DEGRADED');
    expect(result.color).toBe(COLORS.red);
  });

  it('ignores the phantom-degraded glitch and falls through to STARTED', () => {
    const result = deriveArrayStatus(
      makeStatus({ healthStatus: 'DEGRADED', disks: [makeDisk({ status: 'DISK_OK', errors: 0 })] }),
    );
    expect(result.text).toBe('STARTED');
    expect(result.color).toBe(COLORS.green);
  });

  it('does not report DEGRADED when health.status is not DEGRADED, even with a bad disk', () => {
    const result = deriveArrayStatus(
      makeStatus({ healthStatus: 'HEALTHY', disks: [makeDisk({ status: 'DISK_NP_MISSING' })] }),
    );
    expect(result.text).toBe('STARTED');
  });

  it.each([
    ['clear D1', 'CLEARING'],
    ['recon D1', 'REBUILDING'],
    ['recon P', 'REBUILDING'],
    ['recon Q', 'REBUILDING'],
    ['check', 'PARITY CHECK'],
    ['verify', 'PARITY CHECK'], // unknown action tokens fall back to PARITY CHECK
    ['', 'PARITY CHECK'],
  ])('maps active resync action %s to %s', (action, expected) => {
    const result = deriveArrayStatus(makeStatus({ resync: { active: true, action } }));
    expect(result.text).toBe(expected);
    expect(result.color).toBe(COLORS.amber);
  });

  it('trims whitespace around the resync action', () => {
    const result = deriveArrayStatus(makeStatus({ resync: { active: true, action: '  clear D1  ' } }));
    expect(result.text).toBe('CLEARING');
  });

  it.each([
    ['check', 'PARITY CHECK PENDING'],
    ['clear D1', 'CLEARING PENDING'],
    ['recon D1', 'REBUILDING PENDING'],
  ])('marks pending resync %s as %s', (action, expected) => {
    const result = deriveArrayStatus(makeStatus({ resync: { pending: true, active: false, action } }));
    expect(result.text).toBe(expected);
  });

  it('still shows a resync label when the phantom glitch would otherwise say STARTED', () => {
    const result = deriveArrayStatus(
      makeStatus({
        healthStatus: 'DEGRADED',
        resync: { active: true, action: 'check' },
        disks: [makeDisk({ status: 'DISK_OK', errors: 0 })],
      }),
    );
    expect(result.text).toBe('PARITY CHECK');
  });

  it('reports DEGRADED before the resync branch when a disk is genuinely bad during a rebuild', () => {
    // Actual branch order: isDegraded is checked before resync. A transiently INVALID
    // rebuild target still reads as degraded at this layer.
    const result = deriveArrayStatus(
      makeStatus({
        healthStatus: 'DEGRADED',
        resync: { active: true, action: 'recon D1' },
        disks: [makeDisk({ slot: 1, status: 'DISK_INVALID' })],
      }),
    );
    expect(result.text).toBe('DEGRADED');
  });

  it('computes pillBg as a 14% tint of the derived color', () => {
    const result = deriveArrayStatus(makeStatus({ state: 'STOPPED' }));
    expect(result.pillBg).toBe(tint(result.color, 14));
  });
});

describe('deriveDegradedReasons', () => {
  it('returns no reasons for a healthy array', () => {
    expect(deriveDegradedReasons(makeStatus())).toEqual([]);
  });

  it('explains a missing disk', () => {
    const reasons = deriveDegradedReasons(makeStatus({ disks: [makeDisk({ slot: 1, status: 'DISK_NP_MISSING' })] }));
    expect(reasons).toHaveLength(1);
    expect(reasons[0].key).toBe('disk-1');
    expect(reasons[0].title).toBe('Disk 1: Missing');
    expect(reasons[0].diskId).toBe('1');
    expect(reasons[0].detail).toContain('Replace the disk');
  });

  it.each([
    ['DISK_DSBL', 'Disk 1: Disabled'],
    ['DISK_NP_DSBL', 'Disk 1: Disabled, unassigned'],
    ['DISK_INVALID', 'Disk 1: Invalid'],
    ['DISK_WRONG', 'Disk 1: Wrong disk'],
    ['DISK_NEW', 'Disk 1: New'],
    ['DISK_DSBL_NEW', 'Disk 1: New, disabled'],
  ] as const)('maps raw status %s to a readable title', (rawStatus, expectedTitle) => {
    const reasons = deriveDegradedReasons(makeStatus({ disks: [makeDisk({ slot: 1, status: rawStatus })] }));
    expect(reasons).toHaveLength(1);
    expect(reasons[0].title).toBe(expectedTitle);
  });

  it('labels parity disks in the title', () => {
    const p = deriveDegradedReasons(makeStatus({ disks: [makeDisk({ slot: 1, type: 'P', status: 'DISK_DSBL' })] }));
    expect(p[0].title).toBe('Parity 1: Disabled');
    const q = deriveDegradedReasons(makeStatus({ disks: [makeDisk({ slot: 1, type: 'Q', status: 'DISK_DSBL' })] }));
    expect(q[0].title).toBe('Parity 2: Disabled');
  });

  it('falls back to the raw status for unknown status strings', () => {
    const reasons = deriveDegradedReasons(makeStatus({ disks: [makeDisk({ slot: 1, status: 'DISK_FOO' })] }));
    expect(reasons[0].title).toBe('Disk 1: DISK_FOO');
    expect(reasons[0].detail).toBe('This disk is in an abnormal state.');
  });

  it('reports a DISK_OK disk with logged I/O errors', () => {
    const reasons = deriveDegradedReasons(makeStatus({ disks: [makeDisk({ slot: 2, status: 'DISK_OK', errors: 3 })] }));
    expect(reasons).toHaveLength(1);
    expect(reasons[0].key).toBe('disk-errors-2');
    expect(reasons[0].title).toBe('Disk 2: 3 I/O errors logged');
  });

  it('uses singular wording for exactly one logged error', () => {
    const reasons = deriveDegradedReasons(makeStatus({ disks: [makeDisk({ status: 'DISK_OK', errors: 1 })] }));
    expect(reasons[0].title).toBe('Disk 1: 1 I/O error logged');
  });

  it('reports parity sync errors with a correcting-check suggestion', () => {
    const reasons = deriveDegradedReasons(makeStatus({ counters: { sync_errors: 2 } }));
    expect(reasons).toHaveLength(1);
    expect(reasons[0].key).toBe('sync-errors');
    expect(reasons[0].title).toBe('Parity out of sync - 2 errors found');
    expect(reasons[0].startParityCheck).toBe(true);
  });

  it('uses singular wording for one sync error', () => {
    const reasons = deriveDegradedReasons(makeStatus({ counters: { sync_errors: 1 } }));
    expect(reasons[0].title).toBe('Parity out of sync - 1 error found');
  });

  it('combines multiple causes in stable order', () => {
    const reasons = deriveDegradedReasons(
      makeStatus({
        counters: { sync_errors: 2 },
        disks: [
          makeDisk({ slot: 1, status: 'DISK_NP_MISSING' }),
          makeDisk({ slot: 2, status: 'DISK_OK', errors: 3 }),
        ],
      }),
    );
    expect(reasons.map((r) => r.key)).toEqual(['disk-1', 'disk-errors-2', 'sync-errors']);
  });

  it('excludes a disk that is the active rebuild target from problem reasons', () => {
    const reasons = deriveDegradedReasons(
      makeStatus({
        resync: { active: true, action: 'recon D1', progress_percent: 42 },
        disks: [makeDisk({ slot: 1, status: 'DISK_INVALID' })],
      }),
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0].key).toBe('rebuilding');
    expect(reasons[0].title).toBe('Rebuilding Disk 1 from parity');
    expect(reasons[0].detail).toContain('42%');
    expect(reasons[0].diskId).toBeUndefined();
  });

  it('excludes the parity disk being rebuilt', () => {
    const reasons = deriveDegradedReasons(
      makeStatus({
        resync: { active: true, action: 'recon P', progress_percent: 10 },
        disks: [makeDisk({ slot: 1, type: 'P', status: 'DISK_DSBL' })],
      }),
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0].key).toBe('rebuilding');
    expect(reasons[0].title).toBe('Rebuilding Parity 1 from parity');
  });

  it('keeps a genuinely bad disk as a reason even while another disk rebuilds', () => {
    const reasons = deriveDegradedReasons(
      makeStatus({
        resync: { active: true, action: 'recon D1', progress_percent: 50 },
        disks: [
          makeDisk({ slot: 1, status: 'DISK_INVALID' }), // rebuild target - excluded
          makeDisk({ slot: 2, status: 'DISK_NP_MISSING' }), // real problem - kept
        ],
      }),
    );
    expect(reasons.map((r) => r.key)).toEqual(['disk-2', 'rebuilding']);
  });

  it('falls back to the driver health details when nothing else explains DEGRADED', () => {
    const reasons = deriveDegradedReasons(
      makeStatus({
        healthStatus: 'DEGRADED',
        healthDetails: 'Driver internal state is inconsistent',
        disks: [makeDisk({ status: 'DISK_OK', errors: 0 })],
      }),
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0].key).toBe('unknown');
    expect(reasons[0].title).toBe('Array reports degraded');
    expect(reasons[0].detail).toBe('Driver internal state is inconsistent');
  });

  it('returns an empty list when DEGRADED is a phantom glitch with no details', () => {
    const reasons = deriveDegradedReasons(
      makeStatus({
        healthStatus: 'DEGRADED',
        healthDetails: '',
        disks: [makeDisk({ status: 'DISK_OK', errors: 0 })],
      }),
    );
    expect(reasons).toEqual([]);
  });
});

describe('deriveProtection', () => {
  it('returns a loading placeholder for null status', () => {
    expect(deriveProtection(null)).toEqual({
      short: '-',
      color: COLORS.textDim,
      text: 'Loading array status…',
    });
  });

  it('reports Stopped when the array is not started', () => {
    const result = deriveProtection(makeStatus({ state: 'STOPPED' }));
    expect(result.short).toBe('Stopped');
    expect(result.color).toBe(COLORS.textDim);
    expect(result.text).toBe('Array stopped - all disks unmounted.');
  });

  it('reports Degraded with driver details when present', () => {
    const result = deriveProtection(
      makeStatus({
        healthStatus: 'DEGRADED',
        healthDetails: '1 disk missing',
        disks: [makeDisk({ status: 'DISK_NP_MISSING' })],
      }),
    );
    expect(result.short).toBe('Degraded');
    expect(result.color).toBe(COLORS.red);
    expect(result.text).toBe('1 disk missing');
  });

  it('reports Degraded with a missing-disk count when details are empty', () => {
    const result = deriveProtection(
      makeStatus({
        healthStatus: 'DEGRADED',
        healthDetails: '',
        counters: { missing: 2 },
        disks: [makeDisk({ slot: 1, status: 'DISK_NP_MISSING' })],
      }),
    );
    expect(result.text).toBe('2 disks missing. Data is emulated from parity - replace the disk to restore full protection.');
  });

  it('uses singular wording for exactly one missing disk', () => {
    const result = deriveProtection(
      makeStatus({
        healthStatus: 'DEGRADED',
        healthDetails: '',
        counters: { missing: 1 },
        disks: [makeDisk({ status: 'DISK_NP_MISSING' })],
      }),
    );
    expect(result.text).toBe('1 disk missing. Data is emulated from parity - replace the disk to restore full protection.');
  });

  it('reports Dual Parity when a second parity disk is present', () => {
    const result = deriveProtection(makeStatus({ size: { has_second_parity: true } }));
    expect(result.short).toBe('Dual Parity');
    expect(result.color).toBe(COLORS.green);
  });

  it('reports Single Parity when only one parity disk is present', () => {
    const result = deriveProtection(makeStatus({ size: { has_parity: true, has_second_parity: false } }));
    expect(result.short).toBe('Single Parity');
    expect(result.color).toBe(COLORS.green);
  });

  it('reports No Parity when no parity disk is present', () => {
    const result = deriveProtection(makeStatus({ size: { has_parity: false, has_second_parity: false } }));
    expect(result.short).toBe('No Parity');
    expect(result.color).toBe(COLORS.amber);
  });
});

describe('deriveToggleButton', () => {
  it('returns Start Array for null status', () => {
    expect(deriveToggleButton(null)).toEqual({
      label: 'Start Array',
      bg: COLORS.green,
      fg: COLORS.bg,
      border: COLORS.green,
    });
  });

  it('returns Start Array when stopped', () => {
    expect(deriveToggleButton(makeStatus({ state: 'STOPPED' }))).toEqual({
      label: 'Start Array',
      bg: COLORS.green,
      fg: COLORS.bg,
      border: COLORS.green,
    });
  });

  it('returns Stop Array in red when started', () => {
    expect(deriveToggleButton(makeStatus({ state: 'STARTED' }))).toEqual({
      label: 'Stop Array',
      bg: tint(COLORS.red, 15),
      fg: COLORS.red,
      border: COLORS.red,
    });
  });
});
