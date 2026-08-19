import { useEffect, useRef, useState } from 'react';
import { systemApi } from '../api/systemApi';
import type { SystemStats } from '../types/systemApi';

const POLL_MS = 3000;

export function useSystemStats(): SystemStats | null {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const refresh = () => {
      systemApi
        .getStats()
        .then((s) => mounted.current && setStats(s))
        .catch(() => {}); // best-effort - leave last-known stats on a transient failure
    };
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, []);

  return stats;
}
