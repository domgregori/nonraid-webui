import { useState } from 'react';
import { luksApi } from '../api/luksApi';

/**
 * Shared "type a passphrase, call luksApi.unlock(slot, passphrase)" flow - originally
 * disk-detail/LuksSection.tsx's own inline handleUnlock, extracted here so a second caller (the
 * dashboard's per-disk unlock modal, opened from DiskCard's lock icon) doesn't duplicate the same
 * pending/error bookkeeping around that one API call. Not step-up gated - see routes/luks.ts's own
 * reasoning: unlocking uses an already-known secret, it doesn't mint one.
 */
export function useUnlockDisk(slot: number, onUnlocked: () => void) {
  const [passphrase, setPassphrase] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlock = async () => {
    if (!passphrase) return;
    setPending(true);
    setError(null);
    try {
      await luksApi.unlock(slot, passphrase);
      setPassphrase('');
      onUnlocked();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return { passphrase, setPassphrase, pending, error, unlock };
}
