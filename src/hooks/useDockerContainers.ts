import { useCallback, useEffect, useRef, useState } from 'react';
import { dockerApi } from '../api/dockerApi';
import type { ContainerUpdateStatus, DockerContainerSummary } from '../types/dockerApi';

const POLL_MS = 4000;

export type DockerLoadStatus = 'loading' | 'ready' | 'error';

export interface UseDockerContainers {
  containers: DockerContainerSummary[];
  status: DockerLoadStatus;
  error: string | null;
  pendingIds: Set<string>;
  updateStatus: Record<string, ContainerUpdateStatus>;
  checkingUpdates: boolean;
  start: (id: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
  restart: (id: string) => Promise<void>;
  destroy: (id: string) => Promise<void>;
  setAutostart: (id: string, autostart: boolean) => Promise<void>;
  checkContainerUpdate: (id: string) => Promise<void>;
  checkAllUpdates: () => Promise<void>;
  updateNow: (id: string) => Promise<void>;
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
  const [updateStatus, setUpdateStatus] = useState<Record<string, ContainerUpdateStatus>>({});
  const [checkingUpdates, setCheckingUpdates] = useState(false);
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
    // Cheap/cached - whatever the last check (scheduler or a previous page visit) already found,
    // just once on mount rather than polled - a live check is always an explicit user action
    // (checkAllUpdates/checkContainerUpdate below), never something to hammer the registry for
    // silently in the background.
    dockerApi
      .getUpdateStatus()
      .then((s) => mounted.current && setUpdateStatus(s))
      .catch(() => {});
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

  const checkContainerUpdate = useCallback(async (id: string) => {
    setPendingIds((prev) => new Set(prev).add(id));
    try {
      const result = await dockerApi.checkContainerUpdate(id);
      setUpdateStatus((prev) => ({ ...prev, [id]: result }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const checkAllUpdates = useCallback(async () => {
    setCheckingUpdates(true);
    try {
      setUpdateStatus(await dockerApi.checkUpdates());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCheckingUpdates(false);
    }
  }, []);

  return {
    containers,
    status,
    error,
    pendingIds,
    updateStatus,
    checkingUpdates,
    start: (id) => runAction(id, dockerApi.startContainer),
    stop: (id) => runAction(id, dockerApi.stopContainer),
    restart: (id) => runAction(id, dockerApi.restartContainer),
    destroy: (id) => runAction(id, dockerApi.removeContainer),
    setAutostart: (id, autostart) => runAction(id, (i) => dockerApi.setAutostart(i, autostart)),
    checkContainerUpdate,
    checkAllUpdates,
    // Recreates the container under a brand-new id (see the backend route's own comment) - the
    // stale updateStatus entry for the old id is harmless, it's simply never looked up again once
    // refresh() below drops that id from the container list.
    updateNow: (id) => runAction(id, dockerApi.updateContainerNow),
    refresh,
  };
}
