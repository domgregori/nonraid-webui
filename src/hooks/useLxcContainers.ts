import { useCallback, useEffect, useRef, useState } from 'react';
import { lxcApi } from '../api/lxcApi';
import type { LxcContainerSummary } from '../types/lxcApi';

const POLL_MS = 4000;

export type LxcLoadStatus = 'loading' | 'ready' | 'error';

export interface UseLxcContainers {
  containers: LxcContainerSummary[];
  status: LxcLoadStatus;
  error: string | null;
  pendingNames: Set<string>;
  start: (name: string) => Promise<void>;
  stop: (name: string) => Promise<void>;
  restart: (name: string) => Promise<void>;
  destroy: (name: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Polls the backend for the live LXC container list — same shape as
 * useDockerContainers. Actions call the backend then refetch rather than
 * optimistically guessing the resulting state.
 */
export function useLxcContainers(): UseLxcContainers {
  const [containers, setContainers] = useState<LxcContainerSummary[]>([]);
  const [status, setStatus] = useState<LxcLoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [pendingNames, setPendingNames] = useState<Set<string>>(new Set());
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const list = await lxcApi.listContainers();
      if (!mounted.current) return;
      setContainers(list);
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

  const runAction = useCallback(
    async (name: string, action: (name: string) => Promise<unknown>) => {
      setPendingNames((prev) => new Set(prev).add(name));
      try {
        await action(name);
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setPendingNames((prev) => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
      }
    },
    [refresh],
  );

  return {
    containers,
    status,
    error,
    pendingNames,
    start: (name) => runAction(name, lxcApi.startContainer),
    stop: (name) => runAction(name, (n) => lxcApi.stopContainer(n)),
    restart: (name) => runAction(name, lxcApi.restartContainer),
    destroy: (name) => runAction(name, lxcApi.destroyContainer),
    refresh,
  };
}
