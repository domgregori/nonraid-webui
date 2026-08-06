import { COLORS } from '../styles/colors';
import { isDegraded } from './status';
import type { ParityViewModel } from '../types';
import type { NmdStatusResponse, ParityCheckAction } from '../types/nmdApi';

function formatEta(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min remaining`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m remaining`;
}

/** resync is a single shared field — a new-disk clear or a parity rebuild uses the same progress data as a parity check, just a different `action` value. */
function progressVerb(action: string): string {
  if (action.startsWith('clear')) return 'Clearing new disk';
  if (action.startsWith('recon')) return 'Reconstructing parity';
  return 'Checking';
}

export function deriveParityViewModel(
  status: NmdStatusResponse,
  pending: boolean,
  onAction: (action: ParityCheckAction) => void,
): ParityViewModel {
  const { resync, array } = status;
  const arrayStarted = array.state === 'STARTED';
  const degraded = isDegraded(status);
  const canStart = arrayStarted && !resync.active && !pending;
  const progressPct = Math.round(resync.progress_percent);

  return {
    isRunning: resync.active,
    canStart,
    progressPct,
    barColor: degraded ? COLORS.red : COLORS.blue,
    progressLabel: resync.active
      ? `${progressVerb(resync.action)}: ${progressPct}%`
      : array.counters.sync_errors > 0
        ? `Last check: completed, ${array.counters.sync_errors} errors`
        : 'Last check: completed, 0 errors',
    speedText: resync.active && !resync.paused ? `${Math.round(resync.rate_mb_s)} MB/s` : '—',
    etaText: resync.active ? (resync.paused ? 'Paused' : formatEta(resync.eta_seconds)) : '—',
    pauseLabel: resync.paused ? 'Resume' : 'Pause',
    startHandler: () => onAction('CORRECT'),
    pauseHandler: () => onAction(resync.paused ? 'RESUME' : 'PAUSE'),
    cancelHandler: () => onAction('CANCEL'),
  };
}
