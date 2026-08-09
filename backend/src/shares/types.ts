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
  // When true, ShareService.remountAll() grows `disks` to cover any data disk
  // that becomes live and isn't already included — new disk, never a removal,
  // see remountAll()'s doc comment. Meaningless (and rejected) for single-disk.
  allDisks?: boolean;
  allocationMethod: AllocationMethod;
  protocols: ShareProtocol[];
  smb?: { public: boolean };
  nfs?: { allowedHosts: string[]; readOnly: boolean };
  // Optional, free-text, purely informational — also surfaced as smb.conf's
  // `comment =` so it's visible to real SMB clients browsing shares, not just
  // this app's own UI. See realApplier.ts's writeSmbBlock().
  description?: string;
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
  // Live SMB tree-connections right now (from `smbstatus --json`). NFS has no
  // reliable equivalent on this host (see getActiveConnectionCounts()'s doc
  // comment), so this deliberately only ever reflects SMB.
  activeConnections: number;
  access: ShareAccess;
}

export interface ShareCommandResult {
  ok: boolean;
  message: string;
}
