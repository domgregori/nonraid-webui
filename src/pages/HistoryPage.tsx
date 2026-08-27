import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TimeSeriesChart, type TimeSeriesChartSeries } from '../components/shared/TimeSeriesChart';
import { useLiveMetrics } from '../hooks/useLiveMetrics';
import { useMetrics } from '../hooks/useMetrics';
import { ChartHoverProvider } from '../state/ChartHoverProvider';
import { useArrayStatus } from '../state/useArrayStatus';
import { COLORS } from '../styles/colors';
import type { MetricName, MetricRange } from '../types/metricsApi';
import { formatBytesHuman } from '../utils/format';

type ViewMode = MetricRange | 'live';

const RANGES: { value: ViewMode; labelKey: string }[] = [
  { value: '1h', labelKey: 'HistoryPage.range1h' },
  { value: '24h', labelKey: 'HistoryPage.range24h' },
  { value: '7d', labelKey: 'HistoryPage.range7d' },
  { value: '30d', labelKey: 'HistoryPage.range30d' },
  { value: 'live', labelKey: 'HistoryPage.rangeLive' },
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
  const { t } = useTranslation('pages');
  const [view, setView] = useState<ViewMode>('24h');
  const isLive = view === 'live';
  const dbMetrics = useMetrics(ALL_METRICS, isLive ? '1h' : view, !isLive);
  const liveMetrics = useLiveMetrics(isLive);
  const { seriesByMetric, status, error } = isLive ? liveMetrics : dbMetrics;
  const { status: arrayStatus } = useArrayStatus();

  const diskLabel = (slot: string): string => {
    const disk = arrayStatus?.disks.find((d) => String(d.slot) === slot);
    if (!disk) return t('HistoryPage.diskLabel', { slot });
    return disk.type === 'P' ? t('HistoryPage.parity1') : disk.type === 'Q' ? t('HistoryPage.parity2') : t('HistoryPage.diskLabel', { slot: disk.slot });
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
          <div className="page-title">{t('HistoryPage.title')}</div>
          <div className="history-header__desc">
            {isLive
              ? t('HistoryPage.liveDesc')
              : t('HistoryPage.rangeDesc')}
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
              {t(r.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {status === 'loading' && <div className="status-note">{isLive ? t('HistoryPage.waitingForLive') : t('HistoryPage.loadingHistory')}</div>}
      {error && <div className="status-note status-note--error">{error}</div>}

      <ChartHoverProvider>
        <div className="metrics-grid">
          <div className="card metric-card">
            <div className="eyebrow">{t('HistoryPage.cpuEyebrow')}</div>
            <TimeSeriesChart series={totalSeries('cpu_percent', t('HistoryPage.cpuSeriesLabel'), COLORS.blue)} formatValue={formatPercent} />
          </div>

          <div className="card metric-card">
            <div className="eyebrow">{t('HistoryPage.memoryEyebrow')}</div>
            <TimeSeriesChart series={totalSeries('mem_used_bytes', t('HistoryPage.memoryUsedSeriesLabel'), COLORS.blue)} formatValue={formatBytesHuman} />
          </div>

          <div className="card metric-card">
            <div className="eyebrow">{t('HistoryPage.networkEyebrow')}</div>
            <TimeSeriesChart
              series={[
                { key: 'rx', label: t('HistoryPage.downloadSeriesLabel'), color: COLORS.blue, points: (seriesByMetric.net_rx_kb_s ?? [])[0]?.points ?? [] },
                { key: 'tx', label: t('HistoryPage.uploadSeriesLabel'), color: COLORS.green, points: (seriesByMetric.net_tx_kb_s ?? [])[0]?.points ?? [] },
              ]}
              formatValue={formatKbs}
            />
          </div>

          <div className="card metric-card">
            <div className="eyebrow">{t('HistoryPage.diskTempEyebrow')}</div>
            <TimeSeriesChart series={perDiskSeries('disk_temp_c')} formatValue={(v) => `${Math.round(v)}°C`} />
          </div>

          <div className="card metric-card">
            <div className="eyebrow">{t('HistoryPage.diskReadEyebrow')}</div>
            <TimeSeriesChart series={perDiskSeries('disk_read_kb_s')} formatValue={formatKbs} />
          </div>

          <div className="card metric-card">
            <div className="eyebrow">{t('HistoryPage.diskWriteEyebrow')}</div>
            <TimeSeriesChart series={perDiskSeries('disk_write_kb_s')} formatValue={formatKbs} />
          </div>

          <div className="card metric-card metric-card--wide">
            <div className="eyebrow">{t('HistoryPage.diskUsageEyebrow')}</div>
            <TimeSeriesChart series={perDiskSeries('disk_usage_pct')} formatValue={formatPercent} />
          </div>
        </div>
      </ChartHoverProvider>
    </div>
  );
}
