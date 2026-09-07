import { useState } from 'react';
import { luksApi } from '../api/luksApi';
import type { UnlockSecret } from '../types/luksApi';

export interface UnlockAllResult {
  slot: number;
  ok: boolean;
  error?: string;
}

/**
 * Unlocks a set of locked disks with one shared secret (a typed passphrase or an uploaded
 * keyfile - see types/luksApi.ts's UnlockSecret) - every LUKS disk in this app is meant to share
 * the same day-to-day passphrase/key by design (both unlock modes are array-wide, not per-disk -
 * see docs/luks-support-scope.md), so retyping/re-uploading the same secret once per locked disk
 * is pure friction, not a real per-disk choice worth asking for. Calls are sequential rather than
 * parallel: each luksApi.unlock() already triggers its own nmd.mountDisks()/remountGently() on the
 * backend (see luks/service.ts's unlockDisk()), and racing several of those against the same array
 * at once is asking for trouble. A secret that's wrong for one particular disk (formatted
 * separately, outside this app's "one shared secret" convention) fails that one disk without
 * aborting the rest - `results` carries a per-slot outcome so the caller can report exactly which
 * ones didn't take, rather than an all-or-nothing failure that leaves every disk locked over one
 * mismatch.
 *
 * `unlockAll` takes the secret as a call argument rather than owning its own passphrase/keyfile
 * input state, so every caller (the dashboard's LuksLockedCard, the Disks page's UnlockAllDialog)
 * owns whatever input UI it needs on top of this one shared loop-and-track mechanism, instead of
 * each reimplementing it.
 */
export function useUnlockAllDisks(onAnyUnlocked: () => void) {
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<UnlockAllResult[] | null>(null);

  const unlockAll = async (slots: number[], secret: UnlockSecret) => {
    if (slots.length === 0) return;
    setPending(true);
    setResults(null);
    const outcomes: UnlockAllResult[] = [];
    for (const slot of slots) {
      try {
        await luksApi.unlock(slot, secret);
        outcomes.push({ slot, ok: true });
      } catch (err) {
        outcomes.push({ slot, ok: false, error: (err as Error).message });
      }
    }
    setResults(outcomes);
    setPending(false);
    if (outcomes.some((o) => o.ok)) onAnyUnlocked();
  };

  return { pending, results, unlockAll };
}
