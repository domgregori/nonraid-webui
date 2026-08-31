import { useCallback, useEffect, useRef, useState } from 'react';

// Every screen's fetch-on-mount-then-poll pattern, factored out of the original single-screen
// App.tsx so each of the 9 screens doesn't reimplement the same useEffect/setInterval/cleanup.
// `fetcher` is read from a ref rather than a useCallback dependency so passing a fresh arrow
// function inline at every render (the normal way a screen would call this) doesn't restart the
// interval - only `intervalMs` restarts it.
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs = 5000): { data: T | null; error: string | null; refresh: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  return { data, error, refresh };
}
