export interface Share {
  name: string;
  allocMethod: string;
  disks: string;
  protocol: string;
  usedTB: number;
  sizeTB: number;
}

export interface ShareViewModel extends Share {
  pct: number;
}
