// Mirrors backend/src/nmd/types.ts (nmdctl's `status -o json` output). Keep in sync.

export type ArrayHealthStatus = 'ERROR' | 'NEW' | 'NEW_DISK' | 'OFFLINE' | 'PARTIAL' | 'DEGRADED' | 'WARNING' | 'READY' | 'HEALTHY';
export type ArrayMdState = 'STARTED' | 'STOPPED' | 'NEW_ARRAY' | 'RECON_DISK' | 'DISABLE_DISK' | 'SWAP_DSBL' | (string & {});
export type NmdDiskStatus =
  | 'DISK_OK'
  | 'DISK_INVALID'
  | 'DISK_NP_MISSING'
  | 'DISK_WRONG'
  | 'DISK_DSBL'
  | 'DISK_NP_DSBL'
  | 'DISK_NEW'
  | 'DISK_DSBL_NEW'
  | (string & {});
export type DiskSlotType = 'P' | 'Q' | 'data' | (string & {});

export interface NmdArrayHealth {
  status: ArrayHealthStatus;
  details: string;
  code: number;
}

export interface NmdArraySize {
  data_gb: number;
  data_disk_count: number;
  has_parity: boolean;
  has_second_parity: boolean;
  parity_size_gb: number;
  second_parity_size_gb: number;
}

export interface NmdArrayCounters {
  missing: number;
  invalid: number;
  wrong: number;
  disabled: number;
  replaced: number;
  new: number;
  sync_errors: number;
  disk_errors: number;
}

export interface NmdLastSync {
  timestamp: number;
  age_seconds: number;
  elapsed_seconds: number;
  status: string;
}

export interface NmdArrayStatus {
  label: string;
  state: ArrayMdState;
  superblock: string;
  disks_present: number;
  disks_imported: number;
  disks_unassigned: number;
  total_slots: number;
  health: NmdArrayHealth;
  size: NmdArraySize;
  counters: NmdArrayCounters;
  last_sync: NmdLastSync;
}

export interface NmdResyncStatus {
  active: boolean;
  paused: boolean;
  pending: boolean;
  action: string;
  progress_percent: number;
  position_gb: number;
  size_gb: number;
  rate_mb_s: number;
  elapsed_seconds: number;
  eta_seconds: number;
}

export interface NmdDiskFilesystem {
  type: string;
  mountpoint: string;
  usage: string;
}

export interface NmdDisk {
  slot: number;
  type: DiskSlotType;
  size_kb: number;
  size_gb: number;
  device: string;
  status: NmdDiskStatus;
  errors: number;
  reads: number;
  writes: number;
  disk_id: string;
  disk_name: string;
  filesystem?: NmdDiskFilesystem;
}

export interface NmdStatusResponse {
  array: NmdArrayStatus;
  resync: NmdResyncStatus;
  disks: NmdDisk[];
}

export type ParityCheckAction = 'CORRECT' | 'NOCORRECT' | 'PAUSE' | 'RESUME' | 'CANCEL';

export interface NmdCommandResult {
  ok: boolean;
  message: string;
}
