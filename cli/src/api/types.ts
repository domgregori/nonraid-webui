// Minimal mirrors of the backend response shapes this CLI's curated command set actually reads -
// see backend/API.md for the full API and backend/src/nmd/types.ts, backend/src/docker/types.ts,
// backend/src/lxc/types.ts for the authoritative definitions. Deliberately not imported directly
// from backend/src: cli/ is an independent package (its own tsconfig/rootDir), matching how
// backend/ is already independent of the root frontend package - see the handoff's "Decisions
// already made" #4.

export interface NmdArrayStatus {
  label: string;
  state: string;
  disks_present: number;
  disks_imported: number;
  disks_unassigned: number;
  total_slots: number;
  health: { missing: number; disabled: number; replaced: number; new: number; sync_errors: number; disk_errors: number };
}

export interface NmdResyncStatus {
  active: boolean;
  paused: boolean;
  pending: boolean;
  action: string;
  progress_percent: number;
  rate_mb_s: number;
  eta_seconds: number;
}

export interface NmdDisk {
  slot: number;
  type: string;
  size_gb: number;
  device: string;
  status: string;
  disk_name: string;
}

export interface NmdStatusResponse {
  array: NmdArrayStatus;
  resync: NmdResyncStatus;
  disks: NmdDisk[];
}

// Shared shape for nmdctl/Docker/LXC action results alike (start/stop/spin-up/spin-down/...) - all
// three backend clients return exactly this, see backend/src/nmd/types.ts's NmdCommandResult,
// backend/src/docker/types.ts's DockerCommandResult, backend/src/lxc/types.ts's LxcCommandResult.
export interface CommandResult {
  ok: boolean;
  message: string;
}

export interface DockerContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  cpuPercent: number | null;
  memUsedBytes: number | null;
}

export interface LxcContainerSummary {
  name: string;
  state: string;
  autostart: boolean;
  cpuPercent: number | null;
  memUsedBytes: number | null;
  ips: string[];
}
