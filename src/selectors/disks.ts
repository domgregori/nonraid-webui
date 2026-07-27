import { COLORS } from '../styles/colors';
import type { DiskViewModel } from '../types';
import type { NmdDisk, NmdStatusResponse } from '../types/nmdApi';

const STATUS_LABELS: Record<string, string> = {
  DISK_NP_MISSING: 'Missing · Emulated',
  DISK_WRONG: 'Wrong Disk',
  DISK_INVALID: 'Invalid',
  DISK_DSBL: 'Disabled',
  DISK_NP_DSBL: 'Disabled',
  DISK_NEW: 'New',
  DISK_DSBL_NEW: 'New (Disabled)',
};

function formatSize(sizeGb: number): string {
  const tb = sizeGb / 1024;
  if (tb >= 1) return `${Number.isInteger(tb) ? tb : tb.toFixed(1)} TB`;
  if (sizeGb >= 10) return `${Math.round(sizeGb)} GB`;
  return `${sizeGb.toFixed(1)} GB`; // small test disks (e.g. 0.5 GB) need the decimal
}

function parseUsagePct(usage: string | undefined): number {
  const match = usage?.match(/(\d+)%/);
  return match ? Number(match[1]) : 0;
}

function normalize(value: string | undefined): string {
  return value && value !== '-' ? value : '—';
}

export function deriveDisk(disk: NmdDisk, arrayStarted: boolean, tempC: number | null | undefined): DiskViewModel {
  const role: 'parity' | 'data' = disk.type === 'P' || disk.type === 'Q' ? 'parity' : 'data';
  const label = disk.type === 'P' ? 'Parity 1' : disk.type === 'Q' ? 'Parity 2' : `Disk ${disk.slot}`;

  let status: DiskViewModel['status'];
  let statusLabel: string;
  let statusColor: string;
  if (!arrayStarted) {
    status = 'standby';
    statusLabel = 'Standby';
    statusColor = COLORS.textDim;
  } else if (disk.status === 'DISK_OK') {
    status = 'active';
    statusLabel = 'Active';
    statusColor = COLORS.green;
  } else {
    status = 'missing';
    statusLabel = STATUS_LABELS[disk.status] ?? disk.status;
    statusColor = COLORS.red;
  }

  const usedPct = role === 'data' ? parseUsagePct(disk.filesystem?.usage) : 0;
  const sizeTB = disk.size_gb / 1024;
  const tempColor = typeof tempC === 'number' && tempC >= 40 ? COLORS.amber : COLORS.textSecondary;

  return {
    id: String(disk.slot),
    slot: disk.slot,
    label,
    role,
    size: sizeTB,
    device: disk.device,
    usedPct,
    temp: tempC ?? 0,
    status,
    statusLabel,
    statusColor,
    sizeLabel: formatSize(disk.size_gb),
    usedLabel: role === 'parity' ? '—' : `${usedPct}%`,
    fsType: role === 'parity' ? '—' : (disk.filesystem?.type ?? '—').toUpperCase(),
    mountpoint: role === 'parity' ? '—' : normalize(disk.filesystem?.mountpoint),
    tempLabel: typeof tempC === 'number' ? `${Math.round(tempC)}°C` : '—',
    tempColor,
    barWidth: `${usedPct}%`,
    barColor: usedPct >= 90 ? COLORS.red : usedPct >= 75 ? COLORS.amber : COLORS.blue,
    borderColor: status === 'missing' ? COLORS.red : status === 'standby' ? COLORS.border : COLORS.borderLit,
  };
}

export function deriveDisks(
  status: NmdStatusResponse,
  temps: Record<string, number | null>,
): { parity: DiskViewModel[]; data: DiskViewModel[]; all: DiskViewModel[] } {
  const arrayStarted = status.array.state === 'STARTED';
  const sorted = [...status.disks].sort((a, b) => a.slot - b.slot);
  const all = sorted.map((d) => deriveDisk(d, arrayStarted, temps[d.device]));
  return {
    parity: all.filter((d) => d.role === 'parity'),
    data: all.filter((d) => d.role === 'data'),
    all,
  };
}

export function deriveCapacity(dataDisks: DiskViewModel[], arrayStarted: boolean) {
  const totalTB = dataDisks.reduce((s, d) => s + d.size, 0);
  const usedTB = dataDisks.reduce((s, d) => s + d.size * (d.usedPct / 100), 0);
  const freeTB = totalTB - usedTB;
  const pct = arrayStarted && totalTB > 0 ? Math.round((usedTB / totalTB) * 100) : 0;
  // formatSize picks GB vs TB itself — small test disks (e.g. 5 GB total) would
  // otherwise round to "0 / 0 TB" if this stayed hardcoded to TB.
  return {
    usedLabel: formatSize(usedTB * 1024),
    totalLabel: formatSize(totalTB * 1024),
    freeLabel: formatSize(freeTB * 1024),
    pct,
  };
}

export function deriveDisksOnline(disks: DiskViewModel[]): number {
  return disks.filter((d) => d.status === 'active').length;
}
