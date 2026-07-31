import { useCallback, useEffect, useRef, useState } from 'react';
import { dockerApi } from '../api/dockerApi';
import type { DockerContainerSummary } from '../types/dockerApi';

const POLL_MS = 4000;

export type DockerLoadStatus = 'loading' | 'ready' | 'error';

export interface UseDockerContainers {
  containers: DockerContainerSummary[];
  status: DockerLoadStatus;
  error: string | null;
  pendingIds: Set<string>;
  start: (id: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
  restart: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Polls the backend for the live container list. Actions (start/stop/restart)
 * call the backend then immediately refetch so the UI reflects the real state
 * rather than optimistically guessing it.
 */
export function useDockerContainers(): UseDockerContainers {
  const [containers, setContainers] = useState<DockerContainerSummary[]>([]);
  const [status, setStatus] = useState<DockerLoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const list = await dockerApi.listContainers();
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
    async (id: string, action: (id: string) => Promise<unknown>) => {
      setPendingIds((prev) => new Set(prev).add(id));
      try {
        await action(id);
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
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
    pendingIds,
    start: (id) => runAction(id, dockerApi.startContainer),
    stop: (id) => runAction(id, dockerApi.stopContainer),
    restart: (id) => runAction(id, dockerApi.restartContainer),
    refresh,
  };
}
