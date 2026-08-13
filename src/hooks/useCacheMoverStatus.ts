import { useEffect, useRef, useState } from 'react';
import { cacheApi } from '../api/cacheApi';
import type { CacheMoverJobState } from '../types/cacheApi';

const POLL_MS = 2000;

/** Polls the single global cache mover job - mirrors useEmptyDiskStatus, since a real move can run
 *  in the background for a while and needs to stay visible across navigation/dialog lifetimes. */
export function useCacheMoverStatus() {
  const [job, setJob] = useState<CacheMoverJobState | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const poll = () => {
      cacheApi
        .getMoverStatus()
        .then((s) => mounted.current && setJob(s))
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, []);

  return job;
}
