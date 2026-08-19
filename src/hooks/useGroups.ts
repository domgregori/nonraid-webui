import { useCallback, useEffect, useRef, useState } from 'react';
import { groupsApi } from '../api/usersApi';
import type { Group, GroupInput } from '../types/usersApi';

const POLL_MS = 5000;

export type GroupsLoadStatus = 'loading' | 'ready' | 'error';

export interface UseGroups {
  groups: Group[];
  status: GroupsLoadStatus;
  error: string | null;
  actionError: string | null;
  pendingNames: Set<string>;
  create: (input: GroupInput) => Promise<boolean>;
  remove: (name: string) => Promise<boolean>;
}

/** Same polling + refetch-after-action pattern as useShares/useUsers. */
export function useGroups(): UseGroups {
  const [groups, setGroups] = useState<Group[]>([]);
  const [status, setStatus] = useState<GroupsLoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingNames, setPendingNames] = useState<Set<string>>(new Set());
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const list = await groupsApi.list();
      if (!mounted.current) return;
      setGroups(list);
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

  const withPending = useCallback(
    async (name: string, action: () => Promise<void>): Promise<boolean> => {
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
    },
    [refresh],
  );

  return {
    groups,
    status,
    error,
    actionError,
    pendingNames,
    create: (input) => withPending(input.name, async () => { await groupsApi.create(input); }),
    remove: (name) => withPending(name, async () => { await groupsApi.remove(name); }),
  };
}
