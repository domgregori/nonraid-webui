import type { HistoryPanel } from '../types';

export const HISTORY_PANELS: HistoryPanel[] = [
  { name: 'Array Throughput', desc: 'Read/write MB/s across the array over time' },
  { name: 'Disk Temperatures', desc: 'Per-disk temperature trend' },
  { name: 'Parity Check Duration', desc: 'Historical parity check durations & errors' },
  { name: 'CPU Usage', desc: 'System CPU utilization' },
  { name: 'Memory Usage', desc: 'RAM usage over time' },
  { name: 'Network I/O', desc: 'Inbound/outbound network throughput' },
];
