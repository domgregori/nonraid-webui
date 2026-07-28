export type AllocationMethod = 'most-free' | 'fill-up' | 'high-water' | 'single-disk';
export type ShareProtocol = 'smb' | 'nfs';

// Per-user/per-group SMB access level for a share. NFS exports stay host-based
// (see realApplier.ts) — vanilla NFS has no per-user auth to hang this off of.
export type SharePermission = 'read-write' | 'read-only' | 'none' | 'hidden';

// One share's full access list, by principal name. Groups are Samba's "@groupname" syntax.
export interface ShareAccess {
  users: Record<string, SharePermission>;
  groups: Record<string, SharePermission>;
}

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
