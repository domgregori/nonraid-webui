export type DiskQueueItemType = 'add-parity' | 'add-data' | 'add-cache-mirror';
export type DiskQueueItemStatus = 'queued' | 'running' | 'done' | 'failed';
export type DiskQueueItemPhase = 'committing' | 'awaiting-resync' | 'formatting' | null;

export interface DiskQueueItem {
  id: string;
  type: DiskQueueItemType;
  input: { slot: number; device: string } | { deviceA: string; deviceB: string };
  status: DiskQueueItemStatus;
  phase: DiskQueueItemPhase;
  label: string;
  enqueuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  note: string | null;
}

export interface DiskQueueState {
  items: DiskQueueItem[];
  paused: boolean;
}
