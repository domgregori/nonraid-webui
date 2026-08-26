import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserInput } from '../../types/usersApi';

interface AddUserModalProps {
  existingUsernames: string[];
  onCancel: () => void;
  onSubmit: (input: UserInput) => Promise<boolean>;
}

const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const MIN_PASSWORD_LENGTH = 8;

export function AddUserModal({ existingUsernames, onCancel, onSubmit }: AddUserModalProps) {
  const { t } = useTranslation('users');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const validate = (): string | null => {
    if (!USERNAME_RE.test(username)) {
      return t('AddUserModal.invalidUsername');
    }
    if (existingUsernames.includes(username)) return t('AddUserModal.alreadyExists', { username });
    if (password.length < MIN_PASSWORD_LENGTH) return t('AddUserModal.passwordTooShort', { minLength: MIN_PASSWORD_LENGTH });
    if (password !== confirmPassword) return t('AddUserModal.passwordsDontMatch');
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    const ok = await onSubmit({ username, password, groups: [] });
    setSubmitting(false);
    if (!ok) setError(t('AddUserModal.requestFailed'));
  };

  return (
    <>
      <div className="detail-overlay" onClick={onCancel} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{t('AddUserModal.title')}</div>
          <button type="button" className="detail-panel__close" onClick={onCancel} aria-label={t('AddUserModal.close')}>
            &#10005;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="dialog__body">
          <label className="form-field">
            <span className="form-field__label">{t('AddUserModal.usernameLabel')}</span>
            <input
              className="history-input"
              style={{ width: '100%' }}
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder={t('AddUserModal.usernamePlaceholder')}
              autoFocus
            />
          </label>

          <label className="form-field">
            <span className="form-field__label">{t('AddUserModal.passwordLabel')}</span>
            <input
              type="password"
              className="history-input"
              style={{ width: '100%' }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <label className="form-field">
            <span className="form-field__label">{t('AddUserModal.confirmPasswordLabel')}</span>
            <input
              type="password"
              className="history-input"
              style={{ width: '100%' }}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>

          <div className="status-note">{t('AddUserModal.helpNote')}</div>

          {error && <div className="status-note status-note--error">{error}</div>}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onCancel}>
              {t('AddUserModal.cancel')}
            </button>
            <button type="submit" className="btn--primary" disabled={submitting}>
              {submitting ? t('AddUserModal.creating') : t('AddUserModal.createUser')}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
