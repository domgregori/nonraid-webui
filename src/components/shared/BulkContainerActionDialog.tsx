import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface BulkContainerActionDialogProps {
  /** Picks the confirm/progress copy below - both run the exact same sequential flow, only the
   *  wording differs. */
  action: 'stop' | 'restart';
  /** Pre-filtered by the caller to whatever's currently running - stopping/restarting an already-
   *  stopped container isn't this dialog's job to figure out. */
  items: { id: string; name: string }[];
  /** The plain per-container API call (dockerApi.stopContainer, lxcApi.restartContainer, ...) -
   *  not the page's own hook action, since that also tracks a single pendingIds entry and fires a
   *  refresh() after every single container; this runs its own progress instead and refreshes once
   *  via onDone when everything's done. */
  run: (id: string) => Promise<unknown>;
  onDone: () => void;
  onClose: () => void;
}

type Step = 'confirm' | 'running' | 'done';

/**
 * Shared by DockerPage's and LxcPage's "Stop All"/"Restart All" buttons. Runs one at a time rather
 * than all at once - the same reasoning as migrateLxcStorage's own sequential container stop on the
 * backend: a stampede of simultaneous stop/restart calls against every container on the host is
 * exactly the load spike this avoids, and it also gives an honest "N of M" progress readout instead
 * of everything appearing to hang until the slowest one finishes. Reports a per-container result at
 * the end rather than just the page hook's own single last-error string, so one stuck container
 * doesn't hide whether the other nine actually succeeded.
 */
export function BulkContainerActionDialog({ action, items, run, onDone, onClose }: BulkContainerActionDialogProps) {
  const { t } = useTranslation('shared');
  const [step, setStep] = useState<Step>('confirm');
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<{ name: string; error: string }[]>([]);

  const start = async () => {
    setStep('running');
    const failures: { name: string; error: string }[] = [];
    for (let i = 0; i < items.length; i++) {
      setIndex(i);
      try {
        await run(items[i].id);
      } catch (err) {
        failures.push({ name: items[i].name, error: (err as Error).message });
      }
    }
    setFailed(failures);
    setStep('done');
    onDone();
  };

  const close = () => {
    if (step === 'running') return;
    onClose();
  };

  const titleKey = action === 'stop' ? 'BulkContainerActionDialog.stopAllTitle' : 'BulkContainerActionDialog.restartAllTitle';
  const confirmKey = action === 'stop' ? 'BulkContainerActionDialog.stopAllConfirm' : 'BulkContainerActionDialog.restartAllConfirm';
  const progressKey = action === 'stop' ? 'BulkContainerActionDialog.stopping' : 'BulkContainerActionDialog.restarting';
  const doneKey = action === 'stop' ? 'BulkContainerActionDialog.stoppedDone' : 'BulkContainerActionDialog.restartedDone';

  const pct = items.length > 0 ? Math.round(((step === 'done' ? items.length : index) / items.length) * 100) : 100;

  return (
    <>
      <div className="detail-overlay" onClick={close} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{t(titleKey)}</div>
          {step !== 'running' && (
            <button type="button" className="detail-panel__close" onClick={close} aria-label={t('BulkContainerActionDialog.close')}>
              &#10005;
            </button>
          )}
        </div>
        <div className="dialog__body">
          {step === 'confirm' && (
            <>
              <p className="status-note" style={{ margin: '0 0 8px' }}>
                {t(confirmKey, { count: items.length })}
              </p>
              <p className="status-note" style={{ margin: '0 0 8px' }}>
                {items.map((i) => i.name).join(', ')}
              </p>
              <div className="dialog__actions">
                <button type="button" className="btn" onClick={close}>
                  {t('BulkContainerActionDialog.cancel')}
                </button>
                <button type="button" className="btn btn--danger" onClick={start}>
                  {t(titleKey)}
                </button>
              </div>
            </>
          )}

          {step === 'running' && (
            <>
              <div className="progress-track">
                <div className="progress-track__fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="toggle-row__desc">{t(progressKey, { current: index + 1, total: items.length, name: items[index]?.name })}</div>
            </>
          )}

          {step === 'done' && (
            <>
              <div className="status-note">{t(doneKey, { count: items.length - failed.length, total: items.length })}</div>
              {failed.length > 0 && (
                <ul className="browse-bulk-failures">
                  {failed.map((f) => (
                    <li key={f.name}>
                      {f.name}: {f.error}
                    </li>
                  ))}
                </ul>
              )}
              <div className="dialog__actions">
                <button type="button" className="btn" onClick={close}>
                  {t('BulkContainerActionDialog.close')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
