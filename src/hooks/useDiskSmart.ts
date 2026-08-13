import { useCallback, useEffect, useRef, useState } from 'react';
import { smartApi } from '../api/smartApi';
import type { SelfTestType, SmartAttributes } from '../types/smart';

const IDLE_POLL_MS = 15000;
const RUNNING_POLL_MS = 5000;

export type DiskSmartStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseDiskSmart {
  attributes: SmartAttributes | null;
  status: DiskSmartStatus;
  error: string | null;
  testPending: boolean;
  startSelfTest: (type: SelfTestType) => void;
}

/**
 * Fetches SMART attributes/self-test status for one disk slot, on demand
 * (pass null when no detail panel is open - nothing is fetched). Polls
 * faster while a self-test is running so progress updates promptly, same
 * pattern as ArrayStatusProvider's parity-check poll.
 */
export function useDiskSmart(slot: number | null): UseDiskSmart {
  const [attributes, setAttributes] = useState<SmartAttributes | null>(null);
  const [status, setStatus] = useState<DiskSmartStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [testPending, setTestPending] = useState(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (slot === null) return;
    try {
      const attrs = await smartApi.getAttributes(slot);
      if (!mounted.current) return;
      setAttributes(attrs);
      setStatus('ready');
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      setStatus('error');
      setError((err as Error).message);
    }
  }, [slot]);

  useEffect(() => {
    mounted.current = true;
    if (slot === null) {
      setAttributes(null);
      setStatus('idle');
      setError(null);
      return;
    }
    setStatus('loading');
    refresh();
    return () => {
      mounted.current = false;
    };
  }, [slot, refresh]);

  useEffect(() => {
    if (slot === null) return;
    const pollMs = attributes?.selfTest.state === 'running' ? RUNNING_POLL_MS : IDLE_POLL_MS;
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [slot, attributes?.selfTest.state, refresh]);

  const startSelfTest = useCallback(
    (type: SelfTestType) => {
      if (slot === null) return;
      setTestPending(true);
      setError(null);
      smartApi
        .startSelfTest(slot, type)
        .then(() => refresh())
        .catch((err) => setError((err as Error).message))
        .finally(() => setTestPending(false));
    },
    [slot, refresh],
  );

  return { attributes, status, error, testPending, startSelfTest };
}
