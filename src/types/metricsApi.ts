// Mirrors backend/src/metrics/types.ts. Keep in sync.

export type MetricName = 'cpu_percent' | 'mem_used_bytes' | 'net_rx_kb_s' | 'net_tx_kb_s' | 'disk_temp_c' | 'disk_read_kb_s' | 'disk_write_kb_s' | 'disk_usage_pct';

export type MetricRange = '1h' | '24h' | '7d' | '30d';

export interface MetricPoint {
  ts: number;
  value: number;
}

export interface MetricSeries {
  metric: MetricName;
  key: string;
  points: MetricPoint[];
}

export interface MetricsQueryResult {
  series: MetricSeries[];
}
