import { useCallback, useEffect, useRef, useState } from 'react';
import { activityApi } from '../api/activityApi';
import type { ActivityEntry } from '../types/activityApi';

export interface UseActivity {
  entries: ActivityEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * `pollMs` is optional so the same hook covers both consumers: the dashboard
 * card wants a live-ish feed (small limit, polled), the history dialog wants
 * a bigger one-shot fetch with a manual Refresh button (like Docker's
 * LogsDialog) rather than continuously re-rendering a list the user is
 * actively reading.
 */
export function useActivity(limit: number, pollMs?: number): UseActivity {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await activityApi.list(limit);
      if (!mounted.current) return;
      setEntries(result);
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      setError((err as Error).message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    if (!pollMs) {
      return () => {
        mounted.current = false;
      };
    }
    const id = setInterval(refresh, pollMs);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [refresh, pollMs]);

  return { entries, loading, error, refresh };
}
