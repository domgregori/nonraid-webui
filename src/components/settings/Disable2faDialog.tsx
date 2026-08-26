import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authApi } from '../../api/authApi';

interface Disable2faDialogProps {
  onClose: () => void;
  onDone: () => void;
}

/**
 * Disabling two-factor is a real security downgrade - same two-step confirm shape as
 * ShrinkArrayDialog.tsx (this app's other genuinely-risky action), plus a required current-password
 * re-entry before the danger action even enables, matching the disable-TOTP backend route's own
 * requirement.
 */
export function Disable2faDialog({ onClose, onDone }: Disable2faDialogProps) {
  const { t } = useTranslation('settings');
  const [confirming, setConfirming] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleConfirm = async () => {
    setRunning(true);
    setError(null);
    try {
      await authApi.totpDisable(currentPassword);
      setDone(true);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{t('Disable2faDialog.title')}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('Disable2faDialog.close')}>
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          {done ? (
            <div className="status-note">{t('Disable2faDialog.disabledMessage')}</div>
          ) : (
            <>
              <div className="status-note status-note--error">{t('Disable2faDialog.warning')}</div>
              {!confirming ? (
                <div className="dialog__actions">
                  <button type="button" className="btn" onClick={onClose}>
                    {t('Disable2faDialog.cancel')}
                  </button>
                  <button type="button" className="btn btn--danger" onClick={() => setConfirming(true)}>
                    {t('Disable2faDialog.understandContinue')}
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="password"
                    className="history-input"
                    style={{ width: '100%' }}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder={t('Disable2faDialog.currentPasswordPlaceholder')}
                    autoComplete="current-password"
                    autoFocus
                  />
                  {error && <div className="status-note status-note--error">{error}</div>}
                  <div className="dialog__actions">
                    <button type="button" className="btn" disabled={running} onClick={onClose}>
                      {t('Disable2faDialog.cancel')}
                    </button>
                    <button type="button" className="btn btn--danger" disabled={running || !currentPassword} onClick={handleConfirm}>
                      {running ? t('Disable2faDialog.disabling') : t('Disable2faDialog.disableTwoFactor')}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
          {done && (
            <div className="dialog__actions">
              <button type="button" className="btn" onClick={onClose}>
                {t('Disable2faDialog.closeButton')}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
