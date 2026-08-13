import { useState } from 'react';
import { authApi } from '../../api/authApi';
import type { PasskeySummary } from '../../types/authApi';

interface RemovePasskeyDialogProps {
  passkey: PasskeySummary;
  onClose: () => void;
  onDone: () => void;
}

/** Same bespoke two-step confirm shape as Disable2faDialog.tsx - session-gated only, no password
 *  re-entry, since removing one of possibly several factors is lower-stakes than dropping all TOTP. */
export function RemovePasskeyDialog({ passkey, onClose, onDone }: RemovePasskeyDialogProps) {
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setRunning(true);
    setError(null);
    try {
      await authApi.removePasskey(passkey.id);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setRunning(false);
    }
  };

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">Remove "{passkey.name}"</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          <div className="status-note status-note--error">
            This passkey will no longer work for signing in. If it's your only remaining second factor, two-factor
            authentication effectively turns off until you enroll another one.
          </div>
          {error && <div className="status-note status-note--error">{error}</div>}
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
            <div className="dialog__actions">
              <button type="button" className="btn" disabled={running} onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn btn--danger" disabled={running} onClick={handleConfirm}>
                {running ? 'Removing…' : 'Remove Passkey'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
