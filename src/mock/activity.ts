import { COLORS } from '../styles/colors';
import type { ActivityLogEntry } from '../types';

// No backend event-log source exists yet — this stays static/mock until one does.
export const BASE_LOG: ActivityLogEntry[] = [
  { time: '6h ago', text: 'Array started', color: COLORS.blue },
  { time: '1d ago', text: 'Disk 9 SMART self-test passed', color: COLORS.green },
  { time: '3d ago', text: 'Scheduled parity check completed — 0 sync errors', color: COLORS.green },
  { time: '5d ago', text: 'Disk 8 added to slot 8', color: COLORS.blue },
];
