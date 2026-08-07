import { useState } from 'react';
import { useAuth } from '../state/useAuth';

export function SetupPage() {
  const { setup } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
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
          <div className="auth-card__title">nonraid</div>
        </div>
        <div className="auth-card__subtitle">Create the admin account to finish setup. This is the only account for this dashboard.</div>

        <form onSubmit={handleSubmit} className="auth-card__form">
          <label className="form-field">
            <span className="form-field__label">Username</span>
            <input
              className="history-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>
          <label className="form-field">
            <span className="form-field__label">Password</span>
            <input
              type="password"
              className="history-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="form-field">
            <span className="form-field__label">Confirm password</span>
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
            {pending ? 'Creating account…' : 'Create admin account'}
          </button>
        </form>
      </div>
    </div>
  );
}
