/**
 * Types mirror nmdctl's `status -o json` output verbatim (see format_json_output()
 * in tools/nmdctl in the main nonraid repo). Keep these in sync with that function,
 * not with the frontend's own DiskViewModel shape — nmdctl has no concept of disk
 * temperature (that's SMART/hddtemp data, a separate future integration).
 */

export type ArrayHealthStatus = 'ERROR' | 'NEW' | 'NEW_DISK' | 'OFFLINE' | 'PARTIAL' | 'DEGRADED' | 'WARNING' | 'READY' | 'HEALTHY';

export type ArrayMdState =
  | 'STARTED'
  | 'STOPPED'
  | 'NEW_ARRAY'
  | 'RECON_DISK'
  | 'DISABLE_DISK'
  | 'SWAP_DSBL'
  | (string & {}); // `ERROR:<detail>` and other driver states are free-form

export type DiskStatus =
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
  status: DiskStatus;
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

/**
 * A physical block device not currently claimed by any array slot — mirrors
 * `list_available_devices()` in tools/nmdctl (the same scan `nmdctl add`'s
 * unforced path uses): whole disks matching SCSI/SATA/virtio major numbers,
 * each with its largest *unmounted* partition (if any — a disk with no
 * partition, or whose largest partition is mounted, has none) and an
 * exclusive-open lock check (catches a disk in use by something like ZFS
 * that holds it without a filesystem mount).
 */
export interface AvailableDevice {
  device: string; // whole-disk path, e.g. /dev/sdb — kept for internal use (add/replace calls), not meant for display
  partition: string | null; // largest unmounted partition path, e.g. /dev/sdb1 — null if none qualifies
  sizeKb: number | null;
  diskId: string | null; // udevadm ID_SERIAL — null if undetectable (e.g. no by-id entry)
  model: string | null; // udevadm ID_MODEL — the drive's own reported product name
  uuid: string | null; // filesystem UUID of the partition (or whole device, if unpartitioned) — null if unformatted
  locked: boolean; // exclusive-open failed — device likely in use by another process
}

export interface AddDiskResult {
  slot: number;
  message: string;
  // Full raw output across every step of the orchestration (unassign, add,
  // start, check) — shown as-is, same transparency principle as ImportResult.
  output: string;
}

/**
 * A slot `nmdctl import` (always run with -u, see realClient.ts) skipped
 * because the physical partition's size doesn't match the superblock's
 * recorded size for that slot — see the nonraid project's own migration
 * docs: "do not continue the import" when this happens. In unattended mode
 * the driver never guesses which size is right; it just leaves the slot
 * unimported, which nmdctl's own start_array() then refuses to start with
 * (missing-disk check) — so this is surfaced for diagnosis, not as a gate
 * this app has to enforce itself.
 */
export interface ImportSizeMismatch {
  slot: number;
  partitionSizeKb: number | null;
  expectedSizeKb: number | null;
}

export interface ImportResult {
  importedCount: number;
  sizeMismatches: ImportSizeMismatch[];
  // Any other "Error: ..." line from the command's output (e.g. a disk with
  // no matching physical device found) — surfaced verbatim, not re-worded.
  errors: string[];
  // Full raw command output (--no-color) — always shown alongside the parsed
  // summary above so nothing is hidden behind this app's interpretation of it.
  output: string;
}
