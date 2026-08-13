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
  /** The raw driver status string (e.g. "DISK_NP_MISSING") - the normalized `status` above collapses several distinct raw states into "missing"; some actions (like restoring an uncommitted unassign) need to tell those apart. */
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
  /** SMART self-assessment - distinct from `status` above, which reflects the array driver's own
   *  view. A disk can be DISK_OK while SMART already reports failing. */
  health: 'passed' | 'failed' | null;
  healthColor: string;
  healthLabel: string;
  isSSD: boolean | null;
  typeLabel: string;
  /** True for a data disk that's DISK_OK (present, correctly identified, no redundancy problem)
   *  but has never been formatted - nmdctl's own "unknown" filesystem sentinel. Not a parity/
   *  redundancy issue (isDegraded() correctly leaves this alone), but not a disk you can actually
   *  store anything on yet either - surfaced separately so it doesn't get lost inside a plain
   *  green "Active" card. */
  needsFormat: boolean;
}
