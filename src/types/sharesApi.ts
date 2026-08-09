// Mirrors backend/src/shares/types.ts. Keep in sync.
import type { SharePermission } from './usersApi';

export type AllocationMethod = 'most-free' | 'fill-up' | 'high-water' | 'single-disk';
export type ShareProtocol = 'smb' | 'nfs';

export interface ShareAccess {
  users: Record<string, SharePermission>;
  groups: Record<string, SharePermission>;
}

export interface ShareInput {
  name: string;
  disks: number[];
  allDisks?: boolean;
  allocationMethod: AllocationMethod;
  protocols: ShareProtocol[];
  smb?: { public: boolean };
  nfs?: { allowedHosts: string[]; readOnly: boolean };
  description?: string;
}

export interface Share extends ShareInput {}

export interface ShareStats {
  usedBytes: number | null;
  totalBytes: number | null;
}

export interface ShareWithStats extends Share {
  stats: ShareStats;
  activeConnections: number;
  access: ShareAccess;
}

export interface ShareCommandResult {
  ok: boolean;
  message: string;
}
