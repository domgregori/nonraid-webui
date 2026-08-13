import { useCallback, useEffect, useRef, useState } from 'react';
import { metricsApi } from '../api/metricsApi';
import type { MetricName, MetricRange, MetricSeries } from '../types/metricsApi';

// Matches the backend's sample interval (config.metricsSampleIntervalMs) -
// polling faster wouldn't surface anything new, the DB only gets a new row this often.
const POLL_MS = 60_000;

export type MetricsLoadStatus = 'loading' | 'ready' | 'error';

export interface UseMetrics {
  seriesByMetric: Partial<Record<MetricName, MetricSeries[]>>;
  status: MetricsLoadStatus;
  error: string | null;
}

/**
 * `metrics` should be a stable array reference (module-level constant) - it's a dependency via
 * its joined string, not by identity. `enabled` (default true) skips fetching/polling entirely -
 * for HistoryPage's Live mode, which sources its data from useLiveMetrics() instead and has no
 * use for this hook's normal 60s DB-backed poll running in the background at the same time.
 */
export function useMetrics(metrics: MetricName[], range: MetricRange, enabled: boolean = true): UseMetrics {
  const [seriesByMetric, setSeriesByMetric] = useState<Partial<Record<MetricName, MetricSeries[]>>>({});
  const [status, setStatus] = useState<MetricsLoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const result = await metricsApi.query(metrics, range);
      if (!mounted.current) return;
      const grouped: Partial<Record<MetricName, MetricSeries[]>> = {};
      for (const s of result.series) {
        (grouped[s.metric] ??= []).push(s);
      }
      setSeriesByMetric(grouped);
      setStatus('ready');
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      setStatus('error');
      setError((err as Error).message);
    }
  }, [metrics, range]);

  useEffect(() => {
    if (!enabled) return;
    mounted.current = true;
    setStatus('loading');
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [refresh, enabled]);

  return { seriesByMetric, status, error };
}
