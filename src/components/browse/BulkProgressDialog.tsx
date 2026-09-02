import { useTranslation } from 'react-i18next';
import type { BulkJobState } from '../../hooks/useBrowse';

interface BulkProgressDialogProps {
  job: BulkJobState;
  onCancel: () => void;
  onDismiss: () => void;
}

const VERB_ING_KEY: Record<BulkJobState['op'], string> = {
  copy: 'BulkProgressDialog.verbCopying',
  move: 'BulkProgressDialog.verbMoving',
  delete: 'BulkProgressDialog.verbDeleting',
};

export function BulkProgressDialog({ job, onCancel, onDismiss }: BulkProgressDialogProps) {
  const { t } = useTranslation('browse');
  const running = job.result === null && !job.aborted && job.error === null;
  const pct = job.progress ? Math.round((job.progress.index / job.total) * 100) : 0;

  return (
    <>
      <div className="detail-overlay" onClick={running ? undefined : onDismiss} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{t(VERB_ING_KEY[job.op])}…</div>
          {!running && (
            <button type="button" className="detail-panel__close" onClick={onDismiss} aria-label={t('BulkProgressDialog.close')}>
              &#10005;
            </button>
          )}
        </div>

        <div className="dialog__body">
          {running && (
            <>
              <div className="progress-track">
                <div className="progress-track__fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="toggle-row__desc">
                {job.progress
                  ? t('BulkProgressDialog.progressWithName', { current: job.progress.index + 1, total: job.total, name: job.progress.name })
                  : t('BulkProgressDialog.progressNoName', { total: job.total })}
              </div>
              {job.progress?.currentFile && (
                <div className="toggle-row__desc">
                  {t('BulkProgressDialog.fileProgress', { filesDone: job.progress.filesDone, currentFile: job.progress.currentFile })}
                </div>
              )}
              <div className="dialog__actions">
                <button type="button" className="btn btn--danger" onClick={onCancel}>
                  {t('BulkProgressDialog.cancel')}
                </button>
              </div>
            </>
          )}

          {job.error && <div className="status-note status-note--error">{job.error}</div>}

          {job.aborted && <div className="status-note">{t('BulkProgressDialog.cancelledNote')}</div>}

          {job.result && (
            <>
              <div className="status-note">
                {job.result.cancelled
                  ? t('BulkProgressDialog.cancelledAfter', { count: job.result.succeeded.length })
                  : job.result.failed.length > 0
                    ? t('BulkProgressDialog.succeededWithFailed', { succeededCount: job.result.succeeded.length, failedCount: job.result.failed.length })
                    : t('BulkProgressDialog.succeededOnly', { count: job.result.succeeded.length })}
              </div>
              {job.result.failed.length > 0 && (
                <ul className="browse-bulk-failures">
                  {job.result.failed.map((f) => (
                    <li key={f.path}>
                      {f.path}: {f.error}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {!running && (
            <div className="dialog__actions">
              <button type="button" className="btn" onClick={onDismiss}>
                {t('BulkProgressDialog.close')}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
