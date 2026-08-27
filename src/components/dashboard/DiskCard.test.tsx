import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ParityDiskCard, DataDiskCard } from './DiskCard';
import type { DiskViewModel } from '../../types';
import type { ParityViewModel } from '../../types/parity';
import { COLORS } from '../../styles/colors';

function makeDisk(overrides: Partial<DiskViewModel> = {}): DiskViewModel {
  return {
    id: '1',
    slot: 1,
    label: 'Parity 1',
    role: 'parity',
    size: 4,
    device: '/dev/sda',
    diskId: 'id-1',
    usedPct: 0,
    temp: 38,
    status: 'active',
    rawStatus: 'DISK_OK',
    statusLabel: 'Active',
    statusColor: COLORS.green,
    sizeLabel: '4 TB',
    usedLabel: '-',
    freeLabel: '-',
    fsType: '-',
    mountpoint: '-',
    tempLabel: '38°C',
    tempColor: COLORS.textSecondary,
    barWidth: '0%',
    barColor: COLORS.blue,
    borderColor: COLORS.green,
    health: 'passed',
    healthColor: COLORS.green,
    healthLabel: 'SMART OK',
    isSSD: null,
    typeLabel: '-',
    spinState: null,
    customLabel: null,
    needsFormat: false,
    ...overrides,
  };
}

const dataDisk = makeDisk({
  id: '2',
  slot: 2,
  label: 'Disk 2',
  role: 'data',
  size: 2,
  device: '/dev/sdb',
  usedPct: 60,
  temp: 41,
  statusLabel: 'Active',
  sizeLabel: '2 TB',
  usedLabel: '60%',
  fsType: 'EXT4',
  mountpoint: '/mnt/disk2',
  tempLabel: '41°C',
  tempColor: COLORS.amber,
  barWidth: '60%',
  isSSD: false,
  typeLabel: 'HDD',
});

const clearing = {
  isRunning: true,
  isClearing: true,
  needsDriverReload: false,
  canStart: false,
  barColor: COLORS.blue,
  progressPct: 42,
  progressLabel: '42%',
  speedText: '120 MB/s',
  etaText: '35 min remaining',
  etaCompact: '35m remain',
  pauseLabel: 'Pause',
  startHandler: vi.fn(),
  pauseHandler: vi.fn(),
  cancelHandler: vi.fn(),
} satisfies ParityViewModel;

describe('ParityDiskCard', () => {
  it('renders the disk label, status, device, size, temp, and health from props', () => {
    render(<ParityDiskCard disk={dataDisk} onClick={() => {}} />);
    expect(screen.getByText('Disk 2')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('/dev/sdb')).toBeInTheDocument();
    expect(screen.getByText('2 TB')).toBeInTheDocument();
    expect(screen.getByText('41°C')).toBeInTheDocument();
    expect(screen.getByText('SMART OK')).toBeInTheDocument();
  });

  it('applies the parity modifier class', () => {
    const { container } = render(<ParityDiskCard disk={dataDisk} onClick={() => {}} />);
    expect(container.firstChild).toHaveClass('disk-card', 'disk-card--parity');
  });

  it('fires onClick when the card is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ParityDiskCard disk={dataDisk} onClick={onClick} />);
    await user.click(screen.getByText('Disk 2'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('DataDiskCard', () => {
  it('renders the disk label, status, device, size, used, type, temp, and health from props', () => {
    render(<DataDiskCard disk={dataDisk} onClick={() => {}} />);
    expect(screen.getByText('Disk 2')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('/dev/sdb')).toBeInTheDocument();
    expect(screen.getByText('2 TB')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('HDD')).toBeInTheDocument();
    expect(screen.getByText('41°C')).toBeInTheDocument();
    expect(screen.getByText('SMART OK')).toBeInTheDocument();
  });

  it('applies the data modifier class', () => {
    const { container } = render(<DataDiskCard disk={dataDisk} onClick={() => {}} />);
    expect(container.firstChild).toHaveClass('disk-card', 'disk-card--data');
  });

  it('shows the needs-formatting note when the disk needs a filesystem', () => {
    render(<DataDiskCard disk={{ ...dataDisk, needsFormat: true, fsType: 'UNKNOWN' }} onClick={() => {}} />);
    expect(screen.getByText('Needs formatting - no filesystem yet')).toBeInTheDocument();
  });

  it('omits the needs-formatting note for a formatted disk', () => {
    render(<DataDiskCard disk={dataDisk} onClick={() => {}} />);
    expect(screen.queryByText('Needs formatting - no filesystem yet')).not.toBeInTheDocument();
  });

  it('fires onClick when the card is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<DataDiskCard disk={dataDisk} onClick={onClick} />);
    await user.click(screen.getByText('Disk 2'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('DataDiskCard clearing view', () => {
  it('renders clear progress, speed, and ETA instead of the used-space display', () => {
    render(<DataDiskCard disk={dataDisk} onClick={() => {}} clearing={clearing} />);
    expect(screen.getByText('Disk 2')).toBeInTheDocument();
    expect(screen.getByText('Clearing: 42%')).toBeInTheDocument();
    expect(screen.getByText('120 MB/s')).toBeInTheDocument();
    expect(screen.getByText('35m remain')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('calls the pause handler without bubbling the click to the card onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const pauseHandler = vi.fn();
    render(<DataDiskCard disk={dataDisk} onClick={onClick} clearing={{ ...clearing, pauseHandler }} />);
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(pauseHandler).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('calls the cancel handler without bubbling the click to the card onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const cancelHandler = vi.fn();
    render(<DataDiskCard disk={dataDisk} onClick={onClick} clearing={{ ...clearing, cancelHandler }} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancelHandler).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('still fires onClick when the card body (not a control button) is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<DataDiskCard disk={dataDisk} onClick={onClick} clearing={clearing} />);
    await user.click(screen.getByText('Disk 2'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
