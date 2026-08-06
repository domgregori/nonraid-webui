import { useEffect, useRef, useState } from 'react';
import { emptyDiskApi } from '../api/emptyDiskApi';
import type { EmptyDiskJobState } from '../types/emptyDisk';

const POLL_MS = 2000;

/** Polls the single global empty-disk job — mirrors ArrayStatusProvider's resync polling, kept
 *  separate since this can outlive any one dialog (a real move runs in the background for hours). */
export function useEmptyDiskStatus() {
  const [job, setJob] = useState<EmptyDiskJobState | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const poll = () => {
      emptyDiskApi
        .status()
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
