import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCards } from './StatCards';
import type {
  NmdArrayCounters,
  NmdArraySize,
  NmdDisk,
  NmdResyncStatus,
  NmdStatusResponse,
} from '../../types/nmdApi';

const { useArrayStatusMock } = vi.hoisted(() => ({
  useArrayStatusMock: vi.fn(),
}));

vi.mock('../../state/useArrayStatus', () => ({
  useArrayStatus: useArrayStatusMock,
}));

function makeDisk(overrides: Partial<NmdDisk> = {}): NmdDisk {
  return {
    slot: 1,
    type: 'data',
    size_kb: 1024 * 1024 * 1024,
    size_gb: 512,
    device: '/dev/sdb',
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
    disksPresent?: number;
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
      disks_present: overrides.disksPresent ?? (overrides.disks?.length ?? 1),
      disks_imported: overrides.disks?.length ?? 1,
      disks_unassigned: 0,
      total_slots: 4,
      health: {
        status: 'HEALTHY',
        details: overrides.healthDetails ?? '',
        code: 0,
      },
      size: {
        data_gb: 1024,
        data_disk_count: 2,
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

function startedStatus(): NmdStatusResponse {
  return makeStatus({
    state: 'STARTED',
    size: { has_parity: true, has_second_parity: false },
    disks: [
      makeDisk({ slot: 1, type: 'P', size_gb: 1024, device: '/dev/sda' }),
      makeDisk({
        slot: 2,
        type: 'data',
        size_gb: 512,
        device: '/dev/sdb',
        filesystem: { type: 'ext4', mountpoint: '/mnt/disk2', usage: '50%' },
      }),
      makeDisk({
        slot: 3,
        type: 'data',
        size_gb: 512,
        device: '/dev/sdc',
        filesystem: { type: 'ext4', mountpoint: '/mnt/disk3', usage: '25%' },
      }),
    ],
  });
}

describe('StatCards', () => {
  beforeEach(() => {
    useArrayStatusMock.mockReset();
  });

  it('renders the Capacity card from derived disk usage', () => {
    useArrayStatusMock.mockReturnValue({ status: startedStatus(), temps: {} });
    render(<StatCards />);
    expect(screen.getByText('Capacity')).toBeInTheDocument();
    expect(screen.getByText('384 GB')).toBeInTheDocument();
    expect(screen.getByText('/ 1 TB')).toBeInTheDocument();
    expect(screen.getByText('640 GB free')).toBeInTheDocument();
  });

  it('renders the Protection card with the parity status', () => {
    useArrayStatusMock.mockReturnValue({ status: startedStatus(), temps: {} });
    render(<StatCards />);
    expect(screen.getByText('Protection')).toBeInTheDocument();
    expect(screen.getByText('Single Parity')).toBeInTheDocument();
    expect(screen.getByText('Parity disk active - array can survive one disk failure.')).toBeInTheDocument();
  });

  it('renders the Disks card with online and total counts plus parity/data split', () => {
    useArrayStatusMock.mockReturnValue({ status: startedStatus(), temps: {} });
    render(<StatCards />);
    expect(screen.getByText('Disks')).toBeInTheDocument();
    const disksValue = screen.getByText('/ 3 online').closest('.stat-value');
    expect(disksValue).toHaveTextContent('3 / 3 online');
    expect(screen.getByText('1 parity · 2 data')).toBeInTheDocument();
  });

  it('reports Stopped protection and zero disks online when the array is stopped', () => {
    const stopped = startedStatus();
    stopped.array.state = 'STOPPED';
    useArrayStatusMock.mockReturnValue({ status: stopped, temps: {} });
    render(<StatCards />);
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.getByText('Array stopped - all disks unmounted.')).toBeInTheDocument();
    const disksValue = screen.getByText('/ 3 online').closest('.stat-value');
    expect(disksValue).toHaveTextContent('0 / 3 online');
  });

  it('renders nothing while status is still loading', () => {
    useArrayStatusMock.mockReturnValue({ status: null, temps: {} });
    const { container } = render(<StatCards />);
    expect(container.firstChild).toBeNull();
  });
});
