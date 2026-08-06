// Mirrors backend/src/shares/types.ts. Keep in sync.
export type AllocationMethod = 'most-free' | 'fill-up' | 'high-water' | 'single-disk';
export type ShareProtocol = 'smb' | 'nfs';

export interface ShareInput {
  name: string;
  disks: number[];
  allDisks?: boolean;
  allocationMethod: AllocationMethod;
  protocols: ShareProtocol[];
  smb?: { public: boolean };
  nfs?: { allowedHosts: string[]; readOnly: boolean };
}

export interface Share extends ShareInput {}

export interface ShareStats {
  usedBytes: number | null;
  totalBytes: number | null;
}

export interface ShareWithStats extends Share {
  stats: ShareStats;
}

export interface ShareCommandResult {
  ok: boolean;
  message: string;
}
