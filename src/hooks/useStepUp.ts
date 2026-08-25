import { useEffect, useState } from 'react';
import { authApi } from '../api/authApi';

/**
 * Local state behind any "step-up" confirmation (current password, plus a TOTP/backup code if
 * the account has TOTP enrolled) - the client-side half of backend/src/auth/service.ts's
 * verifyStepUp / requireStepUp. Pair with <StepUpFields> to render the actual inputs; pass
 * `password`/`totpCode || undefined` straight into whichever API call needs to carry them.
 *
 * Reusable across any sensitive action, not just SSH keys (the first caller) - fetches
 * `totpEnabled` once so the caller knows whether to even send/require a code.
 */
export function useStepUp() {
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');

  useEffect(() => {
    authApi
      .twoFactorStatus()
      .then((s) => setTotpEnabled(s.totpEnabled))
      .catch(() => {});
  }, []);

  const reset = () => {
    setPassword('');
    setTotpCode('');
  };

  return { totpEnabled, password, setPassword, totpCode, setTotpCode, reset };
}
