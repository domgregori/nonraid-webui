export interface UnfitExample {
  share: string;
  path: string;
  sizeBytes: number;
}

export interface EmptyDiskPlanSummary {
  slot: number;
  fits: boolean;
  fileCount: number;
  totalBytes: number;
  perDestinationBytes: Record<number, number>;
  unfitExamples: UnfitExample[];
  unfitReason: string | null;
  unmanagedBytes: number;
}

export type EmptyDiskJobStatus = 'idle' | 'planning' | 'planned' | 'running' | 'done' | 'failed' | 'cancelled';

export interface EmptyDiskJobState {
  slot: number | null;
  status: EmptyDiskJobStatus;
  totalBytes: number;
  movedBytes: number;
  totalFiles: number;
  movedFiles: number;
  currentFile: string | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}
