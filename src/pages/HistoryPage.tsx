import { useState } from 'react';
import { TimeSeriesChart, type TimeSeriesChartSeries } from '../components/shared/TimeSeriesChart';
import { useLiveMetrics } from '../hooks/useLiveMetrics';
import { useMetrics } from '../hooks/useMetrics';
import { ChartHoverProvider } from '../state/ChartHoverProvider';
import { useArrayStatus } from '../state/useArrayStatus';
import { COLORS } from '../styles/colors';
import type { MetricName, MetricRange } from '../types/metricsApi';
import { formatBytesHuman } from '../utils/format';

type ViewMode = MetricRange | 'live';

const RANGES: { value: ViewMode; label: string }[] = [
  { value: '1h', label: '1H' },
  { value: '24h', label: '24H' },
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: 'live', label: 'LIVE' },
];

const ALL_METRICS: MetricName[] = [
  'cpu_percent',
  'mem_used_bytes',
  'net_rx_kb_s',
  'net_tx_kb_s',
  'disk_temp_c',
  'disk_read_kb_s',
  'disk_write_kb_s',
  'disk_usage_pct',
];

// Rotates for however many disks the array has - COLORS only has 4 semantic
// colors (blue/green/amber/red), so a per-disk chart with 5+ disks needs a
// few extra swatches beyond those.
const DISK_PALETTE = [
  COLORS.blue,
  COLORS.green,
  COLORS.amber,
  COLORS.red,
  COLORS.chartPurple,
  COLORS.chartCyan,
  COLORS.chartPink,
  COLORS.chartLime,
];

function formatPercent(v: number): string {
  return `${Math.round(v)}%`;
}

function formatKbs(v: number): string {
  return v >= 1024 ? `${(v / 1024).toFixed(1)} MB/s` : `${Math.round(v)} KB/s`;
}

export function HistoryPage() {
  const [view, setView] = useState<ViewMode>('24h');
  const isLive = view === 'live';
  const dbMetrics = useMetrics(ALL_METRICS, isLive ? '1h' : view, !isLive);
  const liveMetrics = useLiveMetrics(isLive);
  const { seriesByMetric, status, error } = isLive ? liveMetrics : dbMetrics;
  const { status: arrayStatus } = useArrayStatus();

  const diskLabel = (slot: string): string => {
    const disk = arrayStatus?.disks.find((d) => String(d.slot) === slot);
    if (!disk) return `Disk ${slot}`;
    return disk.type === 'P' ? 'Parity 1' : disk.type === 'Q' ? 'Parity 2' : `Disk ${disk.slot}`;
  };

  const perDiskSeries = (metric: MetricName): TimeSeriesChartSeries[] =>
    (seriesByMetric[metric] ?? [])
      .slice()
      .sort((a, b) => Number(a.key) - Number(b.key))
      .map((s, i) => ({ key: s.key, label: diskLabel(s.key), color: DISK_PALETTE[i % DISK_PALETTE.length], points: s.points }));

  const totalSeries = (metric: MetricName, label: string, color: string): TimeSeriesChartSeries[] => [
    { key: 'total', label, color, points: (seriesByMetric[metric] ?? [])[0]?.points ?? [] },
  ];

  return (
    <div className="page">
      <div className="history-header">
        <div>
          <div className="page-title">History</div>
          <div className="history-header__desc">
            {isLive
              ? 'Live - updating as new data arrives, last 10 minutes'
              : 'CPU, memory, network, and per-disk temperature/read-write/usage over time'}
          </div>
        </div>
        <div className="history-header__controls">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              className={`history-range-btn${view === r.value ? ' history-range-btn--active' : ''}${r.value === 'live' ? ' history-range-btn--live' : ''}`}
              onClick={() => setView(r.value)}
            >
              {r.value === 'live' && view === 'live' && <span className="status-dot" style={{ background: COLORS.green }} />}
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {status === 'loading' && <div className="status-note">{isLive ? 'Waiting for the first live sample…' : 'Loading history…'}</div>}
      {error && <div className="status-note status-note--error">{error}</div>}

      <ChartHoverProvider>
        <div className="metrics-grid">
          <div className="card metric-card">
            <div className="eyebrow">CPU</div>
            <TimeSeriesChart series={totalSeries('cpu_percent', 'CPU', COLORS.blue)} formatValue={formatPercent} />
          </div>

          <div className="card metric-card">
            <div className="eyebrow">Memory</div>
            <TimeSeriesChart series={totalSeries('mem_used_bytes', 'Memory used', COLORS.blue)} formatValue={formatBytesHuman} />
          </div>

          <div className="card metric-card">
            <div className="eyebrow">Network</div>
            <TimeSeriesChart
              series={[
                { key: 'rx', label: 'Download', color: COLORS.blue, points: (seriesByMetric.net_rx_kb_s ?? [])[0]?.points ?? [] },
                { key: 'tx', label: 'Upload', color: COLORS.green, points: (seriesByMetric.net_tx_kb_s ?? [])[0]?.points ?? [] },
              ]}
              formatValue={formatKbs}
            />
          </div>

          <div className="card metric-card">
            <div className="eyebrow">Disk Temperature</div>
            <TimeSeriesChart series={perDiskSeries('disk_temp_c')} formatValue={(v) => `${Math.round(v)}°C`} />
          </div>

          <div className="card metric-card">
            <div className="eyebrow">Disk Read</div>
            <TimeSeriesChart series={perDiskSeries('disk_read_kb_s')} formatValue={formatKbs} />
          </div>

          <div className="card metric-card">
            <div className="eyebrow">Disk Write</div>
            <TimeSeriesChart series={perDiskSeries('disk_write_kb_s')} formatValue={formatKbs} />
          </div>

          <div className="card metric-card metric-card--wide">
            <div className="eyebrow">Disk Usage</div>
            <TimeSeriesChart series={perDiskSeries('disk_usage_pct')} formatValue={formatPercent} />
          </div>
        </div>
      </ChartHoverProvider>
    </div>
  );
}
