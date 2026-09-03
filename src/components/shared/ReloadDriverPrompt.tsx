import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dockerApi } from '../../api/dockerApi';
import { lxcApi } from '../../api/lxcApi';
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
  // Only auto-pick the checkbox on the admin's behalf until they touch it themselves - once
  // they've made an explicit choice, detection finishing late (or a re-run) must not overwrite it.
  // Ref, not state - read from inside the async check below without making "did the admin touch
  // the checkbox mid-check" itself a reason to re-run (and re-fetch) the detection effect.
  const stopContainersTouchedRef = useRef(false);
  const [storageOnArray, setStorageOnArray] = useState<'checking' | boolean>('checking');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reload genuinely stops the array (see nmd.reloadDriver()'s own doc comment) - so if Docker's or
  // LXC's storage actually lives on an array disk, the plain unmount WILL find it busy and the whole
  // reload fails outright (unmountArrayWithContainerRetry only stops containers when asked to). Pre-
  // checking the box in that case turns a guaranteed failed-then-retry round trip into one clean run.
  useEffect(() => {
    if (!confirming) return;
    let cancelled = false;
    setStorageOnArray('checking');
    Promise.all([dockerApi.getStorage().catch(() => null), lxcApi.getStorage().catch(() => null)]).then(([docker, lxc]) => {
      if (cancelled) return;
      const onArray = docker?.mode === 'array' || lxc?.mode === 'array';
      setStorageOnArray(onArray);
      if (onArray && !stopContainersTouchedRef.current) setStopContainers(true);
    });
    return () => {
      cancelled = true;
    };
  }, [confirming]);

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
    // Reset for the next open, so a stale "on array"/checked state from this run never leaks into
    // one where storage has since moved (or the check simply hasn't run yet).
    setStopContainers(false);
    stopContainersTouchedRef.current = false;
    setStorageOnArray('checking');
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
                <input
                  type="checkbox"
                  checked={stopContainers}
                  onChange={(e) => {
                    stopContainersTouchedRef.current = true;
                    setStopContainers(e.target.checked);
                  }}
                  disabled={running}
                />{' '}
                {t('ReloadDriverPrompt.stopContainersLabel')}
              </label>
              {storageOnArray === true && <p className="status-note" style={{ margin: '0 0 8px' }}>{t('ReloadDriverPrompt.storageOnArrayNote')}</p>}
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
