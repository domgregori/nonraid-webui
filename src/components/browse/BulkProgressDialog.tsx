import type { BulkJobState } from '../../hooks/useBrowse';

interface BulkProgressDialogProps {
  job: BulkJobState;
  onCancel: () => void;
  onDismiss: () => void;
}

const VERB_ING: Record<BulkJobState['op'], string> = { copy: 'Copying', move: 'Moving', delete: 'Deleting' };

export function BulkProgressDialog({ job, onCancel, onDismiss }: BulkProgressDialogProps) {
  const running = job.result === null && !job.aborted && job.error === null;
  const pct = job.progress ? Math.round((job.progress.index / job.total) * 100) : 0;

  return (
    <>
      <div className="detail-overlay" onClick={running ? undefined : onDismiss} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{VERB_ING[job.op]}…</div>
          {!running && (
            <button type="button" className="detail-panel__close" onClick={onDismiss} aria-label="Close">
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
                {job.progress ? `${job.progress.index + 1} of ${job.total} - ${job.progress.name}` : `0 of ${job.total}`}
              </div>
              <div className="dialog__actions">
                <button type="button" className="btn btn--danger" onClick={onCancel}>
                  Cancel
                </button>
              </div>
            </>
          )}

          {job.error && <div className="status-note status-note--error">{job.error}</div>}

          {job.aborted && <div className="status-note">Cancelled - some items may have completed before it stopped. The listing has been refreshed.</div>}

          {job.result && (
            <>
              <div className="status-note">
                {job.result.cancelled
                  ? `Cancelled after ${job.result.succeeded.length} item(s).`
                  : `${job.result.succeeded.length} succeeded${job.result.failed.length > 0 ? `, ${job.result.failed.length} failed` : ''}.`}
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
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
