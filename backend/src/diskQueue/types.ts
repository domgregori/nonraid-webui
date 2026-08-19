export type DiskQueueItemType = 'add-parity' | 'add-data' | 'add-cache-mirror';
export type DiskQueueItemStatus = 'queued' | 'running' | 'done' | 'failed';
export type DiskQueueItemPhase = 'committing' | 'awaiting-resync' | 'formatting' | null;

export interface DiskQueueItem {
  id: string;
  type: DiskQueueItemType;
  input: { slot: number; device: string } | { deviceA: string; deviceB: string };
  status: DiskQueueItemStatus;
  phase: DiskQueueItemPhase;
  label: string; // captured at enqueue time, e.g. device model(s)
  enqueuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  /** Set only on a 'done' item that completed with a caveat worth surfacing - e.g. a parity disk
   *  added to a still-blank array, which can't start (nothing to protect yet) until a data disk
   *  joins it too. Distinct from `error`: this is an expected, non-failing outcome, not a problem
   *  the user needs to act on - see DiskQueueService.runAddDiskItem's NO_DATA_DISKS handling. */
  note: string | null;
}

export interface DiskQueueState {
  items: DiskQueueItem[]; // queued + running + up to 5 most recent done/failed
  paused: boolean; // true once the oldest non-done item is 'failed'
}
