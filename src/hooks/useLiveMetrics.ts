import { useEffect, useRef, useState } from 'react';
import { systemApi } from '../api/systemApi';
import type { MetricName, MetricPoint, MetricSeries } from '../types/metricsApi';
import { useArrayStatus } from '../state/useArrayStatus';
import { useSystemStats } from './useSystemStats';
import type { MetricsLoadStatus, UseMetrics } from './useMetrics';

const NET_POLL_MS = 3000;
const DEFAULT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes of rolling history

const BYTES_PER_IO_UNIT = 4096; // see backend/src/metrics/sampler.ts's own comment - same driver convention

interface DiskIoPrev {
  reads: number;
  writes: number;
  ts: number;
}

/**
 * Same shape as useMetrics(), but sourced entirely from data this app already polls for other
 * screens - no new fast server-side sampling loop. CPU/mem ride useSystemStats()'s existing 3s
 * poll; disk temp/usage/read/write ride useArrayStatus()'s existing 2s (status) and 15s (temps)
 * polls, with read/write throughput computed client-side from the same cumulative counters the
 * 60s history sampler itself diffs (see sampler.ts) - just at a finer grain here. Network
 * throughput is the one metric with no existing fast source, so this is the only thing that
 * opens its own poll (GET /system/net-live, only while `enabled`, stopped otherwise) - see
 * backend/src/routes/system.ts.
 *
 * Points are kept in a ref-backed ring buffer (not React state) so appends are cheap; a snapshot
 * is published to state only when something actually changes, matching how often the underlying
 * sources tick anyway (a few times per 2-3s at most, never on a tighter loop than that).
 */
export function useLiveMetrics(enabled: boolean, windowMs: number = DEFAULT_WINDOW_MS): UseMetrics {
  const stats = useSystemStats();
  const { status, temps } = useArrayStatus();

  const [seriesByMetric, setSeriesByMetric] = useState<Partial<Record<MetricName, MetricSeries[]>>>({});
  const [loadStatus, setLoadStatus] = useState<MetricsLoadStatus>('loading');

  const bufferRef = useRef(new Map<MetricName, Map<string, MetricPoint[]>>());
  const diskIoPrevRef = useRef(new Map<number, DiskIoPrev>());

  const appendPoint = (metric: MetricName, key: string, ts: number, value: number) => {
    if (!Number.isFinite(value)) return;
    const byKey = bufferRef.current.get(metric) ?? new Map<string, MetricPoint[]>();
    bufferRef.current.set(metric, byKey);
    const points = byKey.get(key) ?? [];
    points.push({ ts, value });
    const cutoff = ts - windowMs;
    while (points.length > 0 && points[0].ts < cutoff) points.shift();
    byKey.set(key, points);
  };

  const publish = () => {
    const grouped: Partial<Record<MetricName, MetricSeries[]>> = {};
    for (const [metric, byKey] of bufferRef.current) {
      grouped[metric] = [...byKey.entries()].map(([key, points]) => ({ metric, key, points: [...points] }));
    }
    setSeriesByMetric(grouped);
    setLoadStatus('ready');
  };

  // Reset the buffer whenever Live mode turns off then back on, rather than keeping stale points
  // from a previous session around indefinitely.
  useEffect(() => {
    if (!enabled) return;
    bufferRef.current = new Map();
    diskIoPrevRef.current = new Map();
    setSeriesByMetric({});
    setLoadStatus('loading');
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !stats) return;
    const ts = Date.now();
    appendPoint('cpu_percent', 'total', ts, stats.cpuPercent);
    appendPoint('mem_used_bytes', 'total', ts, stats.memUsedBytes);
    publish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, stats]);

  useEffect(() => {
    if (!enabled || !status) return;
    const ts = Date.now();
    for (const disk of status.disks) {
      if (!disk.device || disk.device === 'none') continue;
      const key = String(disk.slot);

      const temp = temps[disk.device];
      if (typeof temp === 'number') appendPoint('disk_temp_c', key, ts, temp);

      if (disk.filesystem?.usage) {
        const pct = Number.parseFloat(disk.filesystem.usage);
        if (Number.isFinite(pct)) appendPoint('disk_usage_pct', key, ts, pct);
      }

      const prev = diskIoPrevRef.current.get(disk.slot);
      if (prev) {
        const dtSec = (ts - prev.ts) / 1000;
        const dReads = disk.reads - prev.reads;
        const dWrites = disk.writes - prev.writes;
        if (dtSec > 0 && dReads >= 0) appendPoint('disk_read_kb_s', key, ts, (dReads * BYTES_PER_IO_UNIT) / 1024 / dtSec);
        if (dtSec > 0 && dWrites >= 0) appendPoint('disk_write_kb_s', key, ts, (dWrites * BYTES_PER_IO_UNIT) / 1024 / dtSec);
      }
      diskIoPrevRef.current.set(disk.slot, { reads: disk.reads, writes: disk.writes, ts });
    }
    publish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, status, temps]);

  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    const poll = () => {
      systemApi
        .getNetLive()
        .then((r) => {
          if (!mounted) return;
          const ts = Date.now();
          if (typeof r.rxKbS === 'number') appendPoint('net_rx_kb_s', 'total', ts, r.rxKbS);
          if (typeof r.txKbS === 'number') appendPoint('net_tx_kb_s', 'total', ts, r.txKbS);
          publish();
        })
        .catch(() => {}); // best-effort - a transient failure just leaves the network chart's window a beat stale
    };
    poll();
    const id = setInterval(poll, NET_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { seriesByMetric, status: loadStatus, error: null };
}
