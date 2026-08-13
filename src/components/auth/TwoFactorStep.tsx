import { startAuthentication } from '@simplewebauthn/browser';
import { useState, type FormEvent } from 'react';
import { authApi } from '../../api/authApi';
import { UnauthorizedError } from '../../api/request';
import { useAuth } from '../../state/useAuth';
import type { TwoFactorMethod } from '../../types/authApi';
import { webauthnAvailable } from '../../utils/webauthnSupport';

interface TwoFactorStepProps {
  methods: TwoFactorMethod[];
}

export function TwoFactorStep({ methods }: TwoFactorStepProps) {
  const { completeTwoFactor } = useAuth();
  const canUsePasskey = methods.includes('passkey') && webauthnAvailable();
  // Defaults to the code form unless TOTP was never enrolled - a passkey is still offered
  // alongside the code form when both are available, not instead of it.
  const [usingPasskey, setUsingPasskey] = useState(!methods.includes('totp') && canUsePasskey);
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
      // request() throws a bare UnauthorizedError (no body) on any 401 - the backend's real
      // "Incorrect code." message never reaches here, so substitute a message that still makes
      // sense for this specific step.
      setError(err instanceof UnauthorizedError ? 'Incorrect code.' : (err as Error).message);
    } finally {
      setPending(false);
    }
  };

  const handlePasskey = async () => {
    setPending(true);
    setError(null);
    try {
      const optionsJSON = await authApi.passkeyAuthOptions();
      const response = await startAuthentication({ optionsJSON });
      await authApi.passkeyAuthVerify(response);
      await completeTwoFactor();
    } catch (err) {
      setError(err instanceof UnauthorizedError ? 'Passkey authentication failed.' : (err as Error).message);
    } finally {
      setPending(false);
    }
  };

  if (usingPasskey) {
    return (
      <div className="auth-card__form">
        <div className="auth-card__subtitle">Use your passkey to finish signing in.</div>
        {error && <div className="status-note status-note--error">{error}</div>}
        <button type="button" className="btn btn--primary btn--block" disabled={pending} onClick={handlePasskey}>
          {pending ? 'Waiting for passkey…' : 'Use Passkey'}
        </button>
        {methods.includes('totp') && (
          <button type="button" className="btn btn--block" disabled={pending} onClick={() => setUsingPasskey(false)}>
            Use a code instead
          </button>
        )}
      </div>
    );
  }

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
      {canUsePasskey && (
        <button type="button" className="btn btn--block" disabled={pending} onClick={() => setUsingPasskey(true)}>
          Use a passkey instead
        </button>
      )}
    </form>
  );
}
