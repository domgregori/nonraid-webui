export type EmptyDiskJobStatus = 'planning' | 'planned' | 'running' | 'done' | 'failed' | 'cancelled';

/** A handful of representative files that don't fit anywhere — enough to explain why, not the full list. */
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
  /** Bytes each destination disk would receive, keyed by slot. */
  perDestinationBytes: Record<number, number>;
  /** Present only when fits is false — a sample of files with nowhere to go, and why. */
  unfitExamples: UnfitExample[];
  unfitReason: string | null;
  /** Real files on this disk that aren't under any share configured to include this
   *  slot — not moved by this plan at all; the caller needs to know they're being left behind. */
  unmanagedBytes: number;
}

export interface EmptyDiskJobState {
  slot: number | null;
  status: EmptyDiskJobStatus | 'idle';
  totalBytes: number;
  movedBytes: number;
  totalFiles: number;
  movedFiles: number;
  currentFile: string | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}
