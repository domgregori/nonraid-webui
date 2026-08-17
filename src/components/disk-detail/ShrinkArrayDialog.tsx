import { useState } from 'react';
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
          <div className="dialog__title">Reconfigure array without {label} (slot {slot})</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          {done ? (
            <div className="status-note">Array reconfigured - slot {slot} no longer exists in the array. Parity is rebuilding.</div>
          ) : (
            <>
              <div className="status-note status-note--error">
                This stops the array, reloads the storage driver, and rebuilds the array's configuration without slot{' '}
                {slot} - then rebuilds parity from scratch. It does not touch real files on any disk you're keeping.
              </div>
              <div className="status-note status-note--error">
                The driver reload step can leave the array briefly down if interrupted - this can take a while and
                shouldn't be cancelled partway. If it fails, the error will include the exact command to recover
                manually.
              </div>
              {!confirming ? (
                <div className="dialog__actions">
                  <button type="button" className="btn" onClick={onClose}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn--danger" onClick={() => setConfirming(true)}>
                    I understand, continue
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
                      Cancel
                    </button>
                    <button type="button" className="btn btn--danger" disabled={running} onClick={() => handleConfirm()}>
                      {running ? 'Reconfiguring…' : `Reconfigure Now`}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
          {done && (
            <div className="dialog__actions">
              <button type="button" className="btn" onClick={onClose}>
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
