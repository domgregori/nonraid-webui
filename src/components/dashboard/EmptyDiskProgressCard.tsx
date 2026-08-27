import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('dashboard');
  const job = useEmptyDiskStatus();
  const [dismissedStartedAt, setDismissedStartedAt] = useState<number | null>(null);

  if (!job || job.status === 'idle') return null;
  if (job.startedAt !== null && job.startedAt === dismissedStartedAt) return null;

  const pct = job.totalBytes > 0 ? Math.round((job.movedBytes / job.totalBytes) * 100) : 0;
  const nothingMoved = job.totalFiles === 0;
  const label =
    job.status === 'running'
      ? t('EmptyDiskProgressCard.emptying', { slot: job.slot, moved: job.movedFiles, total: job.totalFiles })
      : job.status === 'done'
        ? nothingMoved
          ? t('EmptyDiskProgressCard.nothingToMove', { slot: job.slot })
          : job.error
            ? t('EmptyDiskProgressCard.emptiedWithError', { slot: job.slot, error: job.error })
            : t('EmptyDiskProgressCard.emptied', { slot: job.slot })
        : job.status === 'cancelled'
          ? t('EmptyDiskProgressCard.cancelled', { slot: job.slot, moved: job.movedFiles, total: job.totalFiles })
          : job.status === 'failed'
            ? t('EmptyDiskProgressCard.failed', { slot: job.slot, error: job.error ?? t('EmptyDiskProgressCard.unknownError') })
            : '';

  const isTerminal = TERMINAL_STATUSES.includes(job.status);

  return (
    <Card className="parity-card">
      <div className="parity-card__head">
        <div className="eyebrow">{t('EmptyDiskProgressCard.emptyDisk')}</div>
        {job.status === 'running' && (
          <button type="button" className="btn btn--danger" onClick={() => emptyDiskApi.cancel()}>
            {t('EmptyDiskProgressCard.cancel')}
          </button>
        )}
        {isTerminal && (
          <button type="button" className="btn" onClick={() => setDismissedStartedAt(job.startedAt)}>
            {t('EmptyDiskProgressCard.dismiss')}
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
        {job.currentFile && <span title={job.currentFile}>{t('EmptyDiskProgressCard.current', { file: job.currentFile })}</span>}
      </div>
    </Card>
  );
}
