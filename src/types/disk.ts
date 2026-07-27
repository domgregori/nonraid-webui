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
