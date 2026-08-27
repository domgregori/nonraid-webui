import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('settings');
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
          <div className="dialog__title">{t('RemovePasskeyDialog.title', { name: passkey.name })}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('RemovePasskeyDialog.close')}>
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          <div className="status-note status-note--error">{t('RemovePasskeyDialog.warning')}</div>
          {error && <div className="status-note status-note--error">{error}</div>}
          {!confirming ? (
            <div className="dialog__actions">
              <button type="button" className="btn" onClick={onClose}>
                {t('RemovePasskeyDialog.cancel')}
              </button>
              <button type="button" className="btn btn--danger" onClick={() => setConfirming(true)}>
                {t('RemovePasskeyDialog.understandContinue')}
              </button>
            </div>
          ) : (
            <div className="dialog__actions">
              <button type="button" className="btn" disabled={running} onClick={onClose}>
                {t('RemovePasskeyDialog.cancel')}
              </button>
              <button type="button" className="btn btn--danger" disabled={running} onClick={handleConfirm}>
                {running ? t('RemovePasskeyDialog.removing') : t('RemovePasskeyDialog.removePasskey')}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
