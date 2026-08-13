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
  return value && value !== '-' ? value : '-';
}

/** True for a data disk that's DISK_OK (present, correctly identified, no redundancy problem)
 *  but has never been formatted - nmdctl's own "unknown" filesystem sentinel (see get_fs_type()
 *  in tools/nmdctl), not an error state. Parity never has a filesystem of its own by design.
 *  Exported so both the per-disk card border and a dashboard-wide summary can share one check. */
export function diskNeedsFormat(disk: NmdDisk): boolean {
  return disk.type !== 'P' && disk.type !== 'Q' && disk.status === 'DISK_OK' && (!disk.filesystem?.type || disk.filesystem.type === 'unknown');
}

export function deriveDisk(
  disk: NmdDisk,
  arrayStarted: boolean,
  tempC: number | null | undefined,
  health: 'passed' | 'failed' | null | undefined,
  isSSD: boolean | null | undefined,
): DiskViewModel {
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
  const needsFormat = diskNeedsFormat(disk);

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
    rawStatus: disk.status,
    statusLabel,
    statusColor,
    sizeLabel: formatSize(disk.size_gb),
    usedLabel: role === 'parity' ? '-' : `${usedPct}%`,
    fsType: role === 'parity' ? '-' : (disk.filesystem?.type ?? '-').toUpperCase(),
    mountpoint: role === 'parity' ? '-' : normalize(disk.filesystem?.mountpoint),
    tempLabel: typeof tempC === 'number' ? `${Math.round(tempC)}°C` : '-',
    tempColor,
    barWidth: `${usedPct}%`,
    barColor: usedPct >= 90 ? COLORS.red : usedPct >= 75 ? COLORS.amber : COLORS.blue,
    // The only status left once missing/needsFormat/standby are ruled out is 'active' with a real
    // filesystem - a genuinely healthy disk, matching the green "Active" status dot instead of the
    // same neutral borderLit every other card got regardless of health.
    borderColor:
      status === 'missing' ? COLORS.red : needsFormat ? COLORS.amber : status === 'standby' ? COLORS.border : COLORS.green,
    health: health ?? null,
    healthColor: health === 'failed' ? COLORS.red : health === 'passed' ? COLORS.green : COLORS.textDim,
    healthLabel: health === 'failed' ? 'SMART Failing' : health === 'passed' ? 'SMART OK' : 'SMART -',
    isSSD: isSSD ?? null,
    typeLabel: isSSD === true ? 'SSD' : isSSD === false ? 'HDD' : '-',
    needsFormat,
  };
}

export function deriveDisks(
  status: NmdStatusResponse,
  temps: Record<string, number | null>,
  diskHealths: Record<string, 'passed' | 'failed' | null> = {},
  diskTypes: Record<string, boolean | null> = {},
): { parity: DiskViewModel[]; data: DiskViewModel[]; all: DiskViewModel[] } {
  const arrayStarted = status.array.state === 'STARTED';
  const sorted = [...status.disks].sort((a, b) => a.slot - b.slot);
  const all = sorted.map((d) => deriveDisk(d, arrayStarted, temps[d.device], diskHealths[d.device], diskTypes[d.device]));
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
  // formatSize picks GB vs TB itself - small test disks (e.g. 5 GB total) would
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
