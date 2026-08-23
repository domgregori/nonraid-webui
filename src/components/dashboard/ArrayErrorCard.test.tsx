import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArrayErrorCard } from './ArrayErrorCard';
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
      disks_present: overrides.disks?.length ?? 1,
      disks_imported: overrides.disks?.length ?? 1,
      disks_unassigned: 0,
      total_slots: 4,
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

describe('ArrayErrorCard', () => {
  beforeEach(() => {
    useArrayStatusMock.mockReset();
  });

  it('renders nothing while status is loading', () => {
    useArrayStatusMock.mockReturnValue({ status: null });
    const { container } = render(<ArrayErrorCard />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a healthy started array', () => {
    useArrayStatusMock.mockReturnValue({ status: makeStatus() });
    const { container } = render(<ArrayErrorCard />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the error card with the driver state and health details for an ERROR:* state', () => {
    useArrayStatusMock.mockReturnValue({
      status: makeStatus({
        state: 'ERROR:TOO_MANY_MISSING_DISKS',
        healthDetails: 'Too many disks missing to continue.',
      }),
    });
    render(<ArrayErrorCard />);
    expect(screen.getByText('Array Error')).toBeInTheDocument();
    expect(screen.getByText('ERROR:TOO_MANY_MISSING_DISKS')).toBeInTheDocument();
    expect(screen.getByText(/Too many disks missing to continue/)).toBeInTheDocument();
  });

  it('falls back to the default message when health details are empty', () => {
    useArrayStatusMock.mockReturnValue({ status: makeStatus({ state: 'ERROR:NO_DATA_DISKS', healthDetails: '' }) });
    render(<ArrayErrorCard />);
    expect(
      screen.getByText(/the array needs attention before it can start normally/),
    ).toBeInTheDocument();
  });

  it('offers the Reload Driver prompt and opens its confirm dialog', async () => {
    const user = userEvent.setup();
    useArrayStatusMock.mockReturnValue({ status: makeStatus({ state: 'ERROR:INVALID_EXPANSION' }) });
    render(<ArrayErrorCard />);
    const reload = screen.getByRole('button', { name: 'Reload Driver' });
    await user.click(reload);
    expect(screen.getByText('Reload Storage Driver')).toBeInTheDocument();
  });
});
