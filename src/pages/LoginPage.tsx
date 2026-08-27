import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TwoFactorStep } from '../components/auth/TwoFactorStep';
import { UnauthorizedError } from '../api/request';
import { useAuth } from '../state/useAuth';
import type { TwoFactorMethod } from '../types/authApi';

export function LoginPage() {
  const { t } = useTranslation('pages');
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // AuthGate itself needs no new state for this - the whole 2FA sub-flow lives here. A second
  // factor isn't a failure, it's an expected step, so it's tracked separately from `error`.
  const [step, setStep] = useState<'password' | 'twofactor'>('password');
  const [twoFactorMethods, setTwoFactorMethods] = useState<TwoFactorMethod[]>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const outcome = await login(username, password);
      if (!outcome.ok) {
        setTwoFactorMethods(outcome.methods);
        setStep('twofactor');
      }
    } catch (err) {
      // request() throws a bare UnauthorizedError (no body) on any 401 - the backend's real
      // "Invalid username or password." message never reaches here.
      setError(err instanceof UnauthorizedError ? t('LoginPage.invalidCredentials') : (err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card card">
        <div className="auth-card__brand">
          <img src="/logo.png" alt="" className="auth-card__logo" />
          <div className="auth-card__title">{t('LoginPage.brandTitle')}</div>
        </div>
        <div className="auth-card__subtitle">{t('LoginPage.subtitle')}</div>

        {step === 'twofactor' ? (
          <TwoFactorStep methods={twoFactorMethods} />
        ) : (
          <form onSubmit={handleSubmit} className="auth-card__form">
            <label className="form-field">
              <span className="form-field__label">{t('LoginPage.usernameLabel')}</span>
              <input
                className="history-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
              />
            </label>
            <label className="form-field">
              <span className="form-field__label">{t('LoginPage.passwordLabel')}</span>
              <input
                type="password"
                className="history-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>

            {error && <div className="status-note status-note--error">{error}</div>}

            <button type="submit" className="btn btn--primary btn--block" disabled={pending}>
              {pending ? t('LoginPage.signingIn') : t('LoginPage.signIn')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
