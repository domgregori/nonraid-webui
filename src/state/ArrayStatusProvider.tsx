import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { nmdApi } from '../api/nmdApi';
import { smartApi } from '../api/smartApi';
import type { NmdStatusResponse, ParityCheckAction } from '../types/nmdApi';
import { ArrayStatusContext, type LoadState } from './ArrayStatusContext';

const STATUS_POLL_MS = 2000;
const TEMP_POLL_MS = 15000;

export function ArrayStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<NmdStatusResponse | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [temps, setTemps] = useState<Record<string, number | null>>({});
  const [selectedDiskId, setSelectedDiskId] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [arrayPending, setArrayPending] = useState(false);
  const [parityPending, setParityPending] = useState(false);
  const [unassignPending, setUnassignPending] = useState(false);
  const [restorePending, setRestorePending] = useState(false);
  const mounted = useRef(true);
  const statusRef = useRef<NmdStatusResponse | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await nmdApi.getStatus();
      if (!mounted.current) return;
      statusRef.current = s;
      setStatus(s);
      setLoadState('ready');
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      setLoadState('error');
      setError((err as Error).message);
    }
  }, []);

  const refreshTemps = useCallback(async () => {
    try {
      const t = await smartApi.getTemperatures();
      if (!mounted.current) return;
      setTemps(t);
    } catch {
      // temperature reads are best-effort — leave the last-known values on failure
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refreshStatus();
    refreshTemps();
    const statusId = setInterval(refreshStatus, STATUS_POLL_MS);
    const tempId = setInterval(refreshTemps, TEMP_POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(statusId);
      clearInterval(tempId);
    };
  }, [refreshStatus, refreshTemps]);

  const toggleArray = useCallback(() => {
    const current = statusRef.current;
    if (!current) return;
    setArrayPending(true);
    setActionNote(null);
    setActionError(null);
    const call = current.array.state === 'STARTED' ? nmdApi.stopArray() : nmdApi.startArray();
    call
      .then(() => refreshStatus())
      .catch((err) => setActionError((err as Error).message))
      .finally(() => setArrayPending(false));
  }, [refreshStatus]);

  const parityAction = useCallback(
    (action: ParityCheckAction) => {
      setParityPending(true);
      setActionError(null);
      nmdApi
        .parityCheck(action)
        .then(() => refreshStatus())
        .catch((err) => setActionError((err as Error).message))
        .finally(() => setParityPending(false));
    },
    [refreshStatus],
  );

  const selectDisk = useCallback((id: string) => {
    setSelectedDiskId(id);
    setActionNote(null);
  }, []);

  const closeDetail = useCallback(() => {
    setSelectedDiskId(null);
    setActionNote(null);
  }, []);

  const unassignDisk = useCallback(
    (slot: number) => {
      setUnassignPending(true);
      setActionNote(null);
      setActionError(null);
      nmdApi
        .unassignDisk(slot)
        .then((result) => {
          setActionNote(result.message);
          return refreshStatus();
        })
        .catch((err) => setActionError((err as Error).message))
        .finally(() => setUnassignPending(false));
    },
    [refreshStatus],
  );

  const restoreDisk = useCallback(
    (slot: number) => {
      setRestorePending(true);
      setActionNote(null);
      setActionError(null);
      nmdApi
        .restoreDisk(slot)
        .then((result) => {
          setActionNote(result.message);
          return refreshStatus();
        })
        .catch((err) => setActionError((err as Error).message))
        .finally(() => setRestorePending(false));
    },
    [refreshStatus],
  );

  return (
    <ArrayStatusContext.Provider
      value={{
        status,
        loadState,
        error,
        actionError,
        temps,
        selectedDiskId,
        actionNote,
        arrayPending,
        parityPending,
        unassignPending,
        restorePending,
        toggleArray,
        parityAction,
        selectDisk,
        closeDetail,
        unassignDisk,
        restoreDisk,
      }}
    >
      {children}
    </ArrayStatusContext.Provider>
  );
}
