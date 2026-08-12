import { useEffect, useRef, useState } from 'react';
import { diskQueueApi } from '../api/diskQueueApi';
import type { DiskQueueState } from '../types/diskQueue';

const POLL_MS = 2000;

/** Polls the single global disk-add queue — same shape as useEmptyDiskStatus/useCacheMoverStatus.
 *  Plain hook, not a Context: today the queue only has one real consumer (DiskQueueCard), unlike
 *  ArrayStatusProvider's multi-consumer shared-action-pending-flags need. Promote to a Context
 *  later only if a second consumer (e.g. a nav badge) shows up. */
export function useDiskQueueStatus(): DiskQueueState | null {
  const [state, setState] = useState<DiskQueueState | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const poll = () => {
      diskQueueApi
        .getStatus()
        .then((s) => mounted.current && setState(s))
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, []);

  return state;
}
