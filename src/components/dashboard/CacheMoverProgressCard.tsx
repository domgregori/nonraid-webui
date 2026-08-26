import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cacheApi } from '../../api/cacheApi';
import { useCacheMoverStatus } from '../../hooks/useCacheMoverStatus';
import { COLORS } from '../../styles/colors';
import { formatBytesHuman } from '../../utils/format';
import { Card } from '../shared/Card';
import { ProgressBar } from '../shared/ProgressBar';

const TERMINAL_STATUSES = ['done', 'failed', 'cancelled'];

/** Same "only show while relevant, client-dismissible" shape as EmptyDiskProgressCard - the mover
 *  can run in the background for a while (scheduled or manual), independent of any one dialog. */
export function CacheMoverProgressCard() {
  const { t } = useTranslation('dashboard');
  const job = useCacheMoverStatus();
  const [dismissedStartedAt, setDismissedStartedAt] = useState<number | null>(null);

  if (!job || job.status === 'idle') return null;
  if (job.startedAt !== null && job.startedAt === dismissedStartedAt) return null;

  const pct = job.totalBytes > 0 ? Math.round((job.movedBytes / job.totalBytes) * 100) : 0;
  const nothingMoved = job.totalFiles === 0;
  const label =
    job.status === 'running'
      ? t('CacheMoverProgressCard.moving', { moved: job.movedFiles, total: job.totalFiles })
      : job.status === 'done'
        ? nothingMoved
          ? t('CacheMoverProgressCard.nothingToMove')
          : job.error
            ? t('CacheMoverProgressCard.finishedWithError', { error: job.error })
            : t('CacheMoverProgressCard.finished')
        : job.status === 'cancelled'
          ? t('CacheMoverProgressCard.cancelled', { moved: job.movedFiles, total: job.totalFiles })
          : job.status === 'failed'
            ? t('CacheMoverProgressCard.failed', { error: job.error ?? t('CacheMoverProgressCard.unknownError') })
            : '';

  const isTerminal = TERMINAL_STATUSES.includes(job.status);

  return (
    <Card className="parity-card">
      <div className="parity-card__head">
        <div className="eyebrow">{t('CacheMoverProgressCard.cacheMover')}</div>
        {job.status === 'running' && (
          <button type="button" className="btn btn--danger" onClick={() => cacheApi.cancelMover()}>
            {t('CacheMoverProgressCard.cancel')}
          </button>
        )}
        {isTerminal && (
          <button type="button" className="btn" onClick={() => setDismissedStartedAt(job.startedAt)}>
            {t('CacheMoverProgressCard.dismiss')}
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
        {job.currentFile && <span title={job.currentFile}>{t('CacheMoverProgressCard.current', { file: job.currentFile })}</span>}
      </div>
    </Card>
  );
}
