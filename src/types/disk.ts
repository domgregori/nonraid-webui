export type DiskRole = 'parity' | 'data';
export type DiskStatus = 'standby' | 'missing' | 'active';

export interface DiskBase {
  id: string;
  slot: number;
  label: string;
  role: DiskRole;
  size: number;
  device: string;
  usedPct: number;
  temp: number;
}

export interface DiskViewModel extends DiskBase {
  status: DiskStatus;
  /** The raw driver status string (e.g. "DISK_NP_MISSING") — the normalized `status` above collapses several distinct raw states into "missing"; some actions (like restoring an uncommitted unassign) need to tell those apart. */
  rawStatus: string;
  statusLabel: string;
  statusColor: string;
  sizeLabel: string;
  usedLabel: string;
  fsType: string;
  mountpoint: string;
  tempLabel: string;
  tempColor: string;
  barWidth: string;
  barColor: string;
  borderColor: string;
}
