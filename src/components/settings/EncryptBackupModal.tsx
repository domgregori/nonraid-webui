import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface EncryptBackupModalProps {
  // Whether a password is already saved - drives "Encrypt backups" vs "Change password" copy.
  // The real password itself is never round-tripped from the server (see backend's
  // BackupEncryption doc comment) - this modal always starts blank either way.
  hadPassword: boolean;
  // Throw (or reject) to keep the modal open and show the error inline - same contract as any
  // other form submit handler in this app. Resolving closes the modal via onClose.
  onConfirm: (password: string) => Promise<void>;
  onClose: () => void;
}

/**
 * Asks for the backup encryption password twice before saving it - a typo here is much worse
 * than a typo in most fields, since it can quietly make every future backup unrecoverable with
 * the password the admin *thinks* they set. A dedicated modal (rather than the inline field +
 * schedule-wide Save button this replaced) makes that double-entry the actual point of the step,
 * and saves immediately on confirm instead of waiting on an unrelated Save click elsewhere.
 */
export function EncryptBackupModal({ hadPassword, onConfirm, onClose }: EncryptBackupModalProps) {
  const { t } = useTranslation('settings');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!password.trim()) {
      setError(t('EncryptBackupModal.passwordRequired'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('EncryptBackupModal.mismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(password);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="detail-overlay" onClick={() => !busy && onClose()} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{hadPassword ? t('EncryptBackupModal.changeTitle') : t('EncryptBackupModal.title')}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} disabled={busy} aria-label={t('EncryptBackupModal.close')}>
            &#10005;
          </button>
        </div>
        <div className="dialog__body">
          <div className="toggle-row__desc">{t('EncryptBackupModal.description')}</div>
          <label className="field">
            <span>{t('EncryptBackupModal.passwordLabel')}</span>
            <input
              className="history-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              autoFocus
            />
          </label>
          <label className="field">
            <span>{t('EncryptBackupModal.confirmLabel')}</span>
            <input
              className="history-input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </label>
          {error && <div className="status-note status-note--error">{error}</div>}
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              {t('EncryptBackupModal.cancel')}
            </button>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={submit}>
              {busy ? t('EncryptBackupModal.saving') : t('EncryptBackupModal.confirm')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
