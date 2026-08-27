import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../state/useAuth';

export function SetupPage() {
  const { t } = useTranslation('pages');
  const { setup } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError(t('SetupPage.passwordMismatch'));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await setup(username, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card card">
        <div className="auth-card__brand">
          <img src="/logo.png" alt="" className="auth-card__logo" />
          <div className="auth-card__title">{t('SetupPage.brandTitle')}</div>
        </div>
        <div className="auth-card__subtitle">{t('SetupPage.subtitle')}</div>

        <form onSubmit={handleSubmit} className="auth-card__form">
          <label className="form-field">
            <span className="form-field__label">{t('SetupPage.usernameLabel')}</span>
            <input
              className="history-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>
          <label className="form-field">
            <span className="form-field__label">{t('SetupPage.passwordLabel')}</span>
            <input
              type="password"
              className="history-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="form-field">
            <span className="form-field__label">{t('SetupPage.confirmPasswordLabel')}</span>
            <input
              type="password"
              className="history-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>

          {error && <div className="status-note status-note--error">{error}</div>}

          <button type="submit" className="btn btn--primary btn--block" disabled={pending}>
            {pending ? t('SetupPage.creatingAccount') : t('SetupPage.createAccount')}
          </button>
        </form>
      </div>
    </div>
  );
}
