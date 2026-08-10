import { useState, type FormEvent } from 'react';
import { authApi } from '../../api/authApi';
import { UnauthorizedError } from '../../api/request';
import { useAuth } from '../../state/useAuth';
import type { TwoFactorMethod } from '../../types/authApi';

interface TwoFactorStepProps {
  // Not yet branched on — Phase 1 only ever sends 'totp' (passkey enrollment doesn't exist yet).
  // Kept on the props contract now so a passkey branch can be added here later without LoginPage
  // needing to change.
  methods: TwoFactorMethod[];
}

export function TwoFactorStep({ methods: _methods }: TwoFactorStepProps) {
  const { completeTwoFactor } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await authApi.verifyTotp(code);
      await completeTwoFactor();
    } catch (err) {
      // request() throws a bare UnauthorizedError (no body) on any 401 — the backend's real
      // "Incorrect code." message never reaches here, so substitute a message that still makes
      // sense for this specific step.
      setError(err instanceof UnauthorizedError ? 'Incorrect code.' : (err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="auth-card__form">
      <div className="auth-card__subtitle">Enter the code from your authenticator app, or a backup code.</div>
      <label className="form-field">
        <span className="form-field__label">Code</span>
        <input
          className="history-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="one-time-code"
          autoFocus
        />
      </label>
      {error && <div className="status-note status-note--error">{error}</div>}
      <button type="submit" className="btn btn--primary btn--block" disabled={pending || !code}>
        {pending ? 'Verifying…' : 'Verify'}
      </button>
    </form>
  );
}
