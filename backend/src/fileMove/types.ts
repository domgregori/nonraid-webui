export type FileMoveJobStatus = 'planning' | 'planned' | 'running' | 'done' | 'failed' | 'cancelled';

/** A handful of representative files that don't fit anywhere - enough to explain why, not the full list. */
export interface FileMoveUnfitExample {
  share: string;
  path: string;
  sizeBytes: number;
}

export interface FileMovePlanSummary {
  /** Opaque label for the source this plan was built for (e.g. "disk:3", "cache") - display/logging
   *  only, callers own their own identifier scheme. */
  sourceId: string;
  fits: boolean;
  fileCount: number;
  totalBytes: number;
  /** Bytes each destination disk would receive, keyed by array slot. */
  perDestinationBytes: Record<number, number>;
  /** Present only when fits is false - a sample of files with nowhere to go, and why. */
  unfitExamples: FileMoveUnfitExample[];
  unfitReason: string | null;
  /** Real files on the source that aren't under any share configured to draw from it - not moved
   *  by this plan at all; the caller needs to know they're being left behind. */
  unmanagedBytes: number;
}

export interface FileMoveJobState {
  sourceId: string | null;
  status: FileMoveJobStatus | 'idle';
  totalBytes: number;
  movedBytes: number;
  totalFiles: number;
  movedFiles: number;
  currentFile: string | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}
