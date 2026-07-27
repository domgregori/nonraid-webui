import { useCallback, useEffect, useRef, useState } from 'react';
import { sharesApi } from '../api/sharesApi';
import type { ShareInput, ShareWithStats } from '../types/sharesApi';

const POLL_MS = 5000;

export type SharesLoadStatus = 'loading' | 'ready' | 'error';

export interface UseShares {
  shares: ShareWithStats[];
  status: SharesLoadStatus;
  error: string | null;
  actionError: string | null;
  pendingNames: Set<string>;
  create: (input: ShareInput) => Promise<boolean>;
  update: (name: string, input: ShareInput) => Promise<boolean>;
  remove: (name: string) => Promise<boolean>;
}

/** Same polling + refetch-after-action pattern as useDockerContainers. */
export function useShares(): UseShares {
  const [shares, setShares] = useState<ShareWithStats[]>([]);
  const [status, setStatus] = useState<SharesLoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingNames, setPendingNames] = useState<Set<string>>(new Set());
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const list = await sharesApi.list();
      if (!mounted.current) return;
      setShares(list);
      setStatus('ready');
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      setStatus('error');
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  const withPending = useCallback(async (name: string, action: () => Promise<void>): Promise<boolean> => {
    setPendingNames((prev) => new Set(prev).add(name));
    setActionError(null);
    try {
      await action();
      await refresh();
      return true;
    } catch (err) {
      setActionError((err as Error).message);
      return false;
    } finally {
      setPendingNames((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  }, [refresh]);

  return {
    shares,
    status,
    error,
    actionError,
    pendingNames,
    create: (input) => withPending(input.name, async () => { await sharesApi.create(input); }),
    update: (name, input) => withPending(name, async () => { await sharesApi.update(name, input); }),
    remove: (name) => withPending(name, async () => { await sharesApi.remove(name); }),
  };
}
