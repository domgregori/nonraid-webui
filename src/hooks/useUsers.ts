import { useCallback, useEffect, useRef, useState } from 'react';
import { usersApi } from '../api/usersApi';
import type { User, UserInput, UserUpdateInput } from '../types/usersApi';

const POLL_MS = 5000;

export type UsersLoadStatus = 'loading' | 'ready' | 'error';

export interface UseUsers {
  users: User[];
  status: UsersLoadStatus;
  error: string | null;
  actionError: string | null;
  pendingUsernames: Set<string>;
  create: (input: UserInput) => Promise<boolean>;
  update: (username: string, input: UserUpdateInput) => Promise<boolean>;
  remove: (username: string) => Promise<boolean>;
}

/** Same polling + refetch-after-action pattern as useShares. */
export function useUsers(): UseUsers {
  const [users, setUsers] = useState<User[]>([]);
  const [status, setStatus] = useState<UsersLoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingUsernames, setPendingUsernames] = useState<Set<string>>(new Set());
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const list = await usersApi.list();
      if (!mounted.current) return;
      setUsers(list);
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
    async (username: string, action: () => Promise<void>): Promise<boolean> => {
      setPendingUsernames((prev) => new Set(prev).add(username));
      setActionError(null);
      try {
        await action();
        await refresh();
        return true;
      } catch (err) {
        setActionError((err as Error).message);
        return false;
      } finally {
        setPendingUsernames((prev) => {
          const next = new Set(prev);
          next.delete(username);
          return next;
        });
      }
    },
    [refresh],
  );

  return {
    users,
    status,
    error,
    actionError,
    pendingUsernames,
    create: (input) => withPending(input.username, async () => { await usersApi.create(input); }),
    update: (username, input) => withPending(username, async () => { await usersApi.update(username, input); }),
    remove: (username) => withPending(username, async () => { await usersApi.remove(username); }),
  };
}
