// Long/narrow schema - one row per (metric, key, timestamp) - so adding a
// new metric later never needs a migration, just a new MetricName value.
export type MetricName =
  | 'cpu_percent'
  | 'mem_used_bytes'
  | 'net_rx_kb_s'
  | 'net_tx_kb_s'
  | 'disk_temp_c'
  | 'disk_read_kb_s'
  | 'disk_write_kb_s'
  | 'disk_usage_pct';

export const METRIC_NAMES: MetricName[] = [
  'cpu_percent',
  'mem_used_bytes',
  'net_rx_kb_s',
  'net_tx_kb_s',
  'disk_temp_c',
  'disk_read_kb_s',
  'disk_write_kb_s',
  'disk_usage_pct',
];

export interface MetricPoint {
  ts: number; // unix ms
  value: number;
}

export interface MetricSeries {
  metric: MetricName;
  // 'total' for host-wide metrics (cpu/mem/network); the array disk slot
  // number as a string for per-disk metrics (temp/read/write/usage).
  key: string;
  points: MetricPoint[];
}
