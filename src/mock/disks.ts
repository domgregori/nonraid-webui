export interface RawDataDisk {
  slot: number;
  size: number;
  used: number;
  temp: number;
}

export interface RawParityDisk {
  id: string;
  slot: number;
  label: string;
  size: number;
  device: string;
}

export const PARITY_DISKS: RawParityDisk[] = [
  { id: 'p1', slot: 0, label: 'Parity 1', size: 16, device: '/dev/sdb' },
  { id: 'p2', slot: 29, label: 'Parity 2', size: 16, device: '/dev/sdc' },
];

export const DATA_DISKS: RawDataDisk[] = [
  { slot: 1, size: 4, used: 62, temp: 31 },
  { slot: 2, size: 4, used: 58, temp: 30 },
  { slot: 3, size: 8, used: 71, temp: 33 },
  { slot: 4, size: 8, used: 45, temp: 34 },
  { slot: 5, size: 8, used: 83, temp: 42 },
  { slot: 6, size: 10, used: 50, temp: 32 },
  { slot: 7, size: 10, used: 67, temp: 35 },
  { slot: 8, size: 12, used: 38, temp: 29 },
  { slot: 9, size: 14, used: 74, temp: 36 },
  { slot: 10, size: 16, used: 55, temp: 33 },
];

/** Slot that goes missing/emulated-from-parity in the 'degraded' demo scenario. */
export const DEGRADED_MISSING_SLOT = 5;
