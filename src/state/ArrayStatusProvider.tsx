import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { nmdApi } from '../api/nmdApi';
import { CodedError } from '../api/request';
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
  const [stopBlockedByContainers, setStopBlockedByContainers] = useState(false);
  const [temps, setTemps] = useState<Record<string, number | null>>({});
  const [diskHealths, setDiskHealths] = useState<Record<string, 'passed' | 'failed' | null>>({});
  const [diskTypes, setDiskTypes] = useState<Record<string, boolean | null>>({});
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
      if (!mounted.current) return null;
      statusRef.current = s;
      setStatus(s);
      setLoadState('ready');
      setError(null);
      return s;
    } catch (err) {
      if (!mounted.current) return null;
      const notConfigured = err instanceof CodedError && err.code === 'ARRAY_NOT_CONFIGURED';
      setLoadState(notConfigured ? 'not-configured' : 'error');
      setError((err as Error).message);
      return null;
    }
  }, []);

  const refreshTemps = useCallback(async () => {
    try {
      const t = await smartApi.getTemperatures();
      if (!mounted.current) return;
      setTemps(t);
    } catch {
      // temperature reads are best-effort - leave the last-known values on failure
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const h = await smartApi.getHealthStatuses();
      if (!mounted.current) return;
      setDiskHealths(h);
    } catch {
      // best-effort, same as temps - leave the last-known values on failure
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refreshStatus();
    refreshTemps();
    refreshHealth();
    // Rotational type never changes at runtime - fetched once, not on an interval.
    smartApi
      .getDiskTypes()
      .then((t) => mounted.current && setDiskTypes(t))
      .catch(() => {});
    const statusId = setInterval(refreshStatus, STATUS_POLL_MS);
    const tempId = setInterval(refreshTemps, TEMP_POLL_MS);
    const healthId = setInterval(refreshHealth, TEMP_POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(statusId);
      clearInterval(tempId);
      clearInterval(healthId);
    };
  }, [refreshStatus, refreshTemps, refreshHealth]);

  const toggleArray = useCallback(
    (stopContainers = false) => {
      const current = statusRef.current;
      if (!current) return;
      setArrayPending(true);
      setActionNote(null);
      setActionError(null);
      setStopBlockedByContainers(false);
      const stopping = current.array.state === 'STARTED';
      const call = stopping ? nmdApi.stopArray(stopContainers) : nmdApi.startArray();
      call
        .then(() => refreshStatus())
        .catch((err) => {
          setActionError((err as Error).message);
          // Only offer the retry-with-stopContainers prompt on the *first* failed attempt - if
          // the caller already tried with stopContainers and it still failed, offering the same
          // retry again would be misleading (the error banner alone covers that case).
          if (stopping && !stopContainers) setStopBlockedByContainers(true);
        })
        .finally(() => setArrayPending(false));
    },
    [refreshStatus],
  );

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

  const dismissActionError = useCallback(() => {
    setActionError(null);
    setStopBlockedByContainers(false);
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
        stopBlockedByContainers,
        temps,
        diskHealths,
        diskTypes,
        selectedDiskId,
        actionNote,
        arrayPending,
        parityPending,
        unassignPending,
        restorePending,
        refresh: refreshStatus,
        toggleArray,
        dismissActionError,
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
