import { useCallback, useEffect, useRef, useState } from 'react';
import { cacheApi } from '../api/cacheApi';
import type { CacheStatus } from '../types/cacheApi';

const POLL_MS = 5000;

export type CacheLoadStatus = 'loading' | 'ready' | 'error';

export interface UseCacheStatus {
  status: CacheStatus | null;
  loadState: CacheLoadStatus;
  error: string | null;
  refresh: () => Promise<void>;
}

/** Polls like useDockerContainers - cheap enough (one status read) to keep the Dashboard card and
 *  Disks page section both live without any push mechanism. */
export function useCacheStatus(): UseCacheStatus {
  const [status, setStatus] = useState<CacheStatus | null>(null);
  const [loadState, setLoadState] = useState<CacheLoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const result = await cacheApi.getStatus();
      if (!mounted.current) return;
      setStatus(result);
      setLoadState('ready');
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      setLoadState('error');
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

  return { status, loadState, error, refresh };
}
