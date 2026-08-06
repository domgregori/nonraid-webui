import { useCallback, useEffect, useRef, useState } from 'react';
import { nmdApi } from '../api/nmdApi';
import type { AvailableDevice } from '../types/nmdApi';

export type AvailableDevicesStatus = 'loading' | 'ready' | 'error';

export interface UseAvailableDevices {
  devices: AvailableDevice[];
  status: AvailableDevicesStatus;
  error: string | null;
  refresh: () => void;
}

/** On-demand, not polled — scanning for unassigned devices shells out to lsblk/udevadm per candidate, not cheap enough to poll continuously like array status. */
export function useAvailableDevices(): UseAvailableDevices {
  const [devices, setDevices] = useState<AvailableDevice[]>([]);
  const [status, setStatus] = useState<AvailableDevicesStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(() => {
    setStatus('loading');
    setError(null);
    nmdApi
      .listAvailableDevices()
      .then((result) => {
        if (!mounted.current) return;
        setDevices(result);
        setStatus('ready');
      })
      .catch((err) => {
        if (!mounted.current) return;
        setError((err as Error).message);
        setStatus('error');
      });
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  return { devices, status, error, refresh };
}
