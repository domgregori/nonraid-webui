import { useState } from 'react';
import { emptyDiskApi } from '../../api/emptyDiskApi';
import { useEmptyDiskStatus } from '../../hooks/useEmptyDiskStatus';
import { COLORS } from '../../styles/colors';
import { formatBytesHuman } from '../../utils/format';
import { Card } from '../shared/Card';
import { ProgressBar } from '../shared/ProgressBar';

const TERMINAL_STATUSES = ['done', 'failed', 'cancelled'];

/** Only renders while a job is active/finished, and not dismissed - stays out of the way
 *  otherwise. Outlives any one EmptyDiskDialog instance, since a real move can run for
 *  hours in the background. Dismissal is client-side only (no backend "clear" - the job
 *  history itself is harmless to keep, this just stops re-showing an already-read result). */
export function EmptyDiskProgressCard() {
  const job = useEmptyDiskStatus();
  const [dismissedStartedAt, setDismissedStartedAt] = useState<number | null>(null);

  if (!job || job.status === 'idle') return null;
  if (job.startedAt !== null && job.startedAt === dismissedStartedAt) return null;

  const pct = job.totalBytes > 0 ? Math.round((job.movedBytes / job.totalBytes) * 100) : 0;
  const nothingMoved = job.totalFiles === 0;
  const label =
    job.status === 'running'
      ? `Emptying slot ${job.slot}: ${job.movedFiles}/${job.totalFiles} files`
      : job.status === 'done'
        ? nothingMoved
          ? `Slot ${job.slot}: nothing to move - it isn't part of any configured share`
          : `Slot ${job.slot} emptied${job.error ? ` - ${job.error}` : ''}`
        : job.status === 'cancelled'
          ? `Emptying slot ${job.slot} cancelled - ${job.movedFiles}/${job.totalFiles} files moved before stopping`
          : job.status === 'failed'
            ? `Emptying slot ${job.slot} failed: ${job.error ?? 'unknown error'}`
            : '';

  const isTerminal = TERMINAL_STATUSES.includes(job.status);

  return (
    <Card className="parity-card">
      <div className="parity-card__head">
        <div className="eyebrow">Empty Disk</div>
        {job.status === 'running' && (
          <button type="button" className="btn btn--danger" onClick={() => emptyDiskApi.cancel()}>
            Cancel
          </button>
        )}
        {isTerminal && (
          <button type="button" className="btn" onClick={() => setDismissedStartedAt(job.startedAt)}>
            Dismiss
          </button>
        )}
      </div>

      {!nothingMoved && <ProgressBar pct={pct} color={job.status === 'failed' ? COLORS.red : COLORS.blue} height={8} />}

      <div className="parity-card__meta">
        <span>{label}</span>
        {!nothingMoved && (
          <span>
            {formatBytesHuman(job.movedBytes)} / {formatBytesHuman(job.totalBytes)}
          </span>
        )}
        {job.currentFile && <span title={job.currentFile}>Current: {job.currentFile}</span>}
      </div>
    </Card>
  );
}
