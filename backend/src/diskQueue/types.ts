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
}

export interface DiskQueueState {
  items: DiskQueueItem[]; // queued + running + up to 5 most recent done/failed
  paused: boolean; // true once the oldest non-done item is 'failed'
}
