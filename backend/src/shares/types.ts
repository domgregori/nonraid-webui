export type AllocationMethod = 'most-free' | 'fill-up' | 'high-water' | 'single-disk';
export type ShareProtocol = 'smb' | 'nfs';

export interface ShareInput {
  name: string;
  disks: number[]; // data disk slots
  allocationMethod: AllocationMethod;
  protocols: ShareProtocol[];
  smb?: { public: boolean };
  nfs?: { allowedHosts: string[]; readOnly: boolean };
}

// Same shape today, but kept as a distinct type — Share is "validated ShareInput
// that's actually in the store," ShareInput is "untrusted request body."
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
