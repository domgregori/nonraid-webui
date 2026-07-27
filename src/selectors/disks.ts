import { COLORS } from '../styles/colors';
import { DATA_DISKS, DEGRADED_MISSING_SLOT, PARITY_DISKS } from '../mock/disks';
import type { AppState } from '../state/appReducer';
import type { DiskBase, DiskViewModel } from '../types';

export function deriveDisk(base: DiskBase, arrayStarted: boolean, missing: boolean): DiskViewModel {
  let status: DiskViewModel['status'];
  let statusLabel: string;
  let statusColor: string;
  if (!arrayStarted) {
    status = 'standby';
    statusLabel = 'Standby';
    statusColor = COLORS.textDim;
  } else if (missing) {
    status = 'missing';
    statusLabel = 'Missing · Emulated';
    statusColor = COLORS.red;
  } else {
    status = 'active';
    statusLabel = 'Active';
    statusColor = COLORS.green;
  }

  const usedPct = base.usedPct ?? 0;
  const fsType = base.role === 'parity' ? '—' : 'XFS';
  const mountpoint = !arrayStarted || base.role === 'parity' ? '—' : '/mnt/disk' + base.slot;
  const tempLabel = !arrayStarted || missing || base.role === 'parity' ? '—' : base.temp + '°C';
  const tempColor = base.temp >= 40 ? COLORS.amber : COLORS.textSecondary;
  const barWidth = (base.role === 'parity' ? 100 : usedPct) + '%';
  const barColor = usedPct >= 90 ? COLORS.red : usedPct >= 75 ? COLORS.amber : COLORS.blue;
  const borderColor = status === 'missing' ? COLORS.red : status === 'standby' ? COLORS.border : COLORS.borderLit;

  return {
    ...base,
    status,
    statusLabel,
    statusColor,
    sizeLabel: base.size + ' TB',
    usedLabel: base.role === 'parity' ? '—' : usedPct + '%',
    fsType,
    mountpoint,
    tempLabel,
    tempColor,
    barWidth,
    barColor,
    borderColor,
  };
}

export function deriveDisks(state: AppState): { parity: DiskViewModel[]; data: DiskViewModel[]; all: DiskViewModel[] } {
  const { arrayStarted, scenario } = state;
  const degraded = scenario === 'degraded';

  const parity = PARITY_DISKS.map((d) =>
    deriveDisk({ id: d.id, slot: d.slot, label: d.label, role: 'parity', size: d.size, device: d.device, usedPct: 0, temp: 0 }, arrayStarted, false),
  );

  const data = DATA_DISKS.map((d) => {
    const missing = degraded && d.slot === DEGRADED_MISSING_SLOT;
    const base: DiskBase = {
      id: 'd' + d.slot,
      slot: d.slot,
      label: 'Disk ' + d.slot,
      role: 'data',
      size: d.size,
      device: arrayStarted ? '/dev/nmd' + d.slot + 'p1' : '/dev/sd' + String.fromCharCode(100 + d.slot),
      usedPct: d.used,
      temp: d.temp,
    };
    return deriveDisk(base, arrayStarted, missing);
  });

  return { parity, data, all: [...parity, ...data] };
}

export function deriveCapacity(dataDisks: DiskViewModel[], arrayStarted: boolean) {
  const totalTB = dataDisks.reduce((s, d) => s + d.size, 0);
  const usedTB = Math.round(dataDisks.reduce((s, d) => s + d.size * (d.usedPct / 100), 0));
  const freeTB = totalTB - usedTB;
  const pct = arrayStarted ? Math.round((usedTB / totalTB) * 100) : 0;
  return { usedTB, totalTB, freeTB, pct };
}

export function deriveDisksOnline(disks: DiskViewModel[]): number {
  return disks.filter((d) => d.status === 'active').length;
}
