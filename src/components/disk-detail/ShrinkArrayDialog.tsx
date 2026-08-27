import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { nmdApi } from '../../api/nmdApi';
import { ArrayActionErrorBanner } from '../shared/ArrayActionErrorBanner';

interface ShrinkArrayDialogProps {
  slot: number;
  label: string;
  onClose: () => void;
  onDone: () => void;
}

/**
 * The one genuinely riskier operation in this app: reconfiguring the array's
 * own topology to drop a permanently-disabled slot for good. Unlike every
 * other disk action here, the backend has to reload the kernel module partway
 * through - if that specific step fails, the array is left down needing a
 * manual command to bring back (the error message from the backend spells
 * out exactly what to run, same as the real recovery used to build this
 * feature). Real data on the disks being *kept* is never touched - only the
 * array's own metadata changes, and parity gets rebuilt from scratch after.
 */
export function ShrinkArrayDialog({ slot, label, onClose, onDone }: ShrinkArrayDialogProps) {
  const { t } = useTranslation('diskDetail');
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Only offered after a *first* failed attempt (see ArrayStatusProvider's toggleArray for the
  // same reasoning) - a retry that already used stopContainers failing again is just a real error.
  const [stopBlockedByContainers, setStopBlockedByContainers] = useState(false);

  const handleConfirm = async (stopContainers = false) => {
    setRunning(true);
    setError(null);
    setStopBlockedByContainers(false);
    try {
      await nmdApi.shrinkArray([slot], stopContainers);
      setDone(true);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      if (!stopContainers) setStopBlockedByContainers(true);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{t('ShrinkArrayDialog.title', { label, slot })}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('ShrinkArrayDialog.close')}>
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          {done ? (
            <div className="status-note">{t('ShrinkArrayDialog.done', { slot })}</div>
          ) : (
            <>
              <div className="status-note status-note--error">
                {t('ShrinkArrayDialog.warning1', { slot })}
              </div>
              <div className="status-note status-note--error">
                {t('ShrinkArrayDialog.warning2')}
              </div>
              {!confirming ? (
                <div className="dialog__actions">
                  <button type="button" className="btn" onClick={onClose}>
                    {t('ShrinkArrayDialog.cancel')}
                  </button>
                  <button type="button" className="btn btn--danger" onClick={() => setConfirming(true)}>
                    {t('ShrinkArrayDialog.understandContinue')}
                  </button>
                </div>
              ) : (
                <>
                  {error && (
                    <ArrayActionErrorBanner
                      actionError={error}
                      stopBlockedByContainers={stopBlockedByContainers}
                      arrayPending={running}
                      onRetryWithStopContainers={() => handleConfirm(true)}
                    />
                  )}
                  <div className="dialog__actions">
                    <button type="button" className="btn" disabled={running} onClick={onClose}>
                      {t('ShrinkArrayDialog.cancel')}
                    </button>
                    <button type="button" className="btn btn--danger" disabled={running} onClick={() => handleConfirm()}>
                      {running ? t('ShrinkArrayDialog.reconfiguring') : t('ShrinkArrayDialog.reconfigureNow')}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
          {done && (
            <div className="dialog__actions">
              <button type="button" className="btn" onClick={onClose}>
                {t('ShrinkArrayDialog.close')}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
