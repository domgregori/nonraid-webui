import { useCallback, useEffect, useRef, useState } from 'react';
import { usersApi } from '../api/usersApi';
import type { PendingImportUser } from '../types/unraidImportApi';

export type PendingImportUsersLoadStatus = 'loading' | 'ready' | 'error';

export interface UsePendingImportUsers {
  pending: PendingImportUser[];
  status: PendingImportUsersLoadStatus;
  error: string | null;
  actionError: string | null;
  pendingUsernames: Set<string>;
  create: (username: string, password: string) => Promise<boolean>;
  discard: (username: string) => Promise<boolean>;
  refresh: () => void;
}

/** Same create/discard-with-pending shape as useUsers, minus the 5s poll - unlike real users
 *  (which can change from a completely different admin session), this list only ever changes from
 *  an import committing or from this same hook's own actions, so a plain refresh after each is
 *  enough; nothing external needs catching up to. */
export function usePendingImportUsers(): UsePendingImportUsers {
  const [pending, setPending] = useState<PendingImportUser[]>([]);
  const [status, setStatus] = useState<PendingImportUsersLoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingUsernames, setPendingUsernames] = useState<Set<string>>(new Set());
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const list = await usersApi.listPendingImport();
      if (!mounted.current) return;
      setPending(list);
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
    load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const withPending = useCallback(
    async (username: string, action: () => Promise<void>): Promise<boolean> => {
      setPendingUsernames((prev) => new Set(prev).add(username));
      setActionError(null);
      try {
        await action();
        await load();
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
    [load],
  );

  return {
    pending,
    status,
    error,
    actionError,
    pendingUsernames,
    create: (username, password) => withPending(username, async () => { await usersApi.createFromPendingImport(username, password); }),
    discard: (username) => withPending(username, async () => { await usersApi.discardPendingImport(username); }),
    refresh: load,
  };
}
