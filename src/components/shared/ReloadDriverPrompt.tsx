import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { nmdApi } from '../../api/nmdApi';

interface ReloadDriverPromptProps {
  /** Context-specific explanation of why *this* card is offering a reload - the confirm step's
   *  own risk/behavior text (stop-containers checkbox, "doesn't change array config") stays fixed. */
  description: string;
  onReloaded?: () => void;
}

/** Two-step "Reload Driver" control for stale driver-side counters - counters that accumulate
 *  across import calls within one loaded module session (num_new, num_invalid, etc. in the kernel
 *  driver's own status_resync()) and are only ever reset by a fresh module load, not a plain
 *  stop/start. Shared by ArrayErrorCard (an ERROR:* array state), ParityCheckCard (a clear/recon
 *  stuck pending with no real disk behind it), Settings > Array, and Settings > Services (the
 *  driver's own row) - same underlying driver quirk, four different surfaces.
 *
 * The confirm step is a modal rather than an inline expand - it used to render in place, which
 * looked fine in a full-width Card body but read badly crammed into a narrow row (see
 * ServicesSection's driver row, confirmed live). A modal doesn't care what it's triggered from. */
export function ReloadDriverPrompt({ description, onReloaded }: ReloadDriverPromptProps) {
  const { t } = useTranslation('shared');
  const [confirming, setConfirming] = useState(false);
  const [stopContainers, setStopContainers] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReload = async () => {
    setRunning(true);
    setError(null);
    try {
      await nmdApi.reloadDriver(stopContainers);
      setConfirming(false);
      onReloaded?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const close = () => {
    if (running) return;
    setConfirming(false);
    setError(null);
  };

  return (
    <>
      <button type="button" className="btn btn--danger" onClick={() => setConfirming(true)}>
        {t('ReloadDriverPrompt.reloadDriver')}
      </button>
      {confirming && (
        <>
          <div className="detail-overlay" onClick={close} />
          <div className="dialog">
            <div className="dialog__head">
              <div className="dialog__title">{t('ReloadDriverPrompt.title')}</div>
              <button type="button" className="detail-panel__close" onClick={close} aria-label={t('ReloadDriverPrompt.close')}>
                &#10005;
              </button>
            </div>
            <div className="dialog__body">
              <p className="status-note" style={{ margin: '0 0 8px' }}>
                {description}
              </p>
              <label className="status-note" style={{ display: 'block', marginBottom: 8 }}>
                <input type="checkbox" checked={stopContainers} onChange={(e) => setStopContainers(e.target.checked)} disabled={running} />{' '}
                {t('ReloadDriverPrompt.stopContainersLabel')}
              </label>
              {error && <div className="status-note status-note--error">{error}</div>}
              <div className="dialog__actions">
                <button type="button" className="btn" disabled={running} onClick={close}>
                  {t('ReloadDriverPrompt.cancel')}
                </button>
                <button type="button" className="btn btn--danger" disabled={running} onClick={handleReload}>
                  {running ? t('ReloadDriverPrompt.reloading') : t('ReloadDriverPrompt.confirmReload')}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
