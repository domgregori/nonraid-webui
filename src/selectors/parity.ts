import { COLORS } from '../styles/colors';
import { isDegraded } from './status';
import type { ParityViewModel } from '../types';
import type { NmdStatusResponse, ParityCheckAction } from '../types/nmdApi';

function formatEta(seconds: number): string {
  if (!seconds || seconds <= 0) return '-';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min remaining`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m remaining`;
}

function formatEtaCompact(seconds: number): string {
  if (!seconds || seconds <= 0) return '-';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m remain`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m remain`;
}

/** resync is a single shared field - a new-disk clear or a parity rebuild uses the same progress
 *  data as a parity check, just a different `action` value - except a rebuild's action is often
 *  plain "check" too (see isRebuild's own doc comment), hence the separate flag rather than
 *  trusting the action string alone for this one. */
function progressVerb(action: string, isRebuild: boolean): string {
  if (action.startsWith('clear')) return 'Clearing new disk';
  if (action.startsWith('recon') || isRebuild) return 'Reconstructing parity';
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
  // See realClient.ts's parityCheck() for the full story: the driver's own num_new/num_invalid
  // counters only ever increment within a loaded module's lifetime, never decrement, so
  // unassigning a disk that had briefly gone "new" can leave a clear/recon permanently pending
  // with size_gb stuck at 0 - no real disk behind it, and Start is guaranteed to fail with a raw
  // "Invalid argument" until the driver's reloaded. "check" pending (an actual queued parity
  // check) doesn't hit this - its size comes from every disk's real size, never legitimately 0.
  const needsDriverReload =
    resync.pending && !resync.active && resync.size_gb === 0 && !resync.action.trim().toLowerCase().startsWith('check');
  const canStart = arrayStarted && !resync.active && !pending && !needsDriverReload;
  const progressPct = Math.round(resync.progress_percent);
  const isClearing = resync.action.trim().toLowerCase().startsWith('clear');
  // See ParityViewModel's own doc comment for why this needs isDegraded rather than the action
  // string alone - a real rebuild's action is plain "check", same as a routine scheduled check.
  const isRebuild = degraded && !isClearing && (resync.pending || resync.active);

  return {
    isRunning: resync.active,
    isClearing,
    needsDriverReload,
    isRebuild,
    canStart,
    progressPct,
    barColor: degraded ? COLORS.red : COLORS.blue,
    progressLabel: resync.active
      ? `${progressVerb(resync.action, isRebuild)}: ${progressPct}%`
      : needsDriverReload
        ? 'Stuck pending with no real disk behind it - reload the driver to clear this'
        : resync.pending
          ? // Queued but not yet started (e.g. a new disk waiting to be cleared before it joins, or
            // a disk waiting to be rebuilt after a replacement) - distinct from resync.active, and
            // from the driver's perspective can sit like this indefinitely until something calls
            // Start. Falling through to the "Last check" summary below here would misreport a
            // still-pending operation as already finished.
            `${isClearing ? 'New disk needs to be cleared' : isRebuild ? 'Disk needs to be rebuilt' : 'Queued'} - press Start to begin`
          : array.counters.sync_errors > 0
            ? `Last check: completed, ${array.counters.sync_errors} errors`
            : 'Last check: completed, 0 errors',
    speedText: resync.active && !resync.paused ? `${Math.round(resync.rate_mb_s)} MB/s` : '-',
    etaText: resync.active ? (resync.paused ? 'Paused' : formatEta(resync.eta_seconds)) : '-',
    etaCompact: resync.active ? (resync.paused ? 'Paused' : formatEtaCompact(resync.eta_seconds)) : '-',
    pauseLabel: resync.paused ? 'Resume' : 'Pause',
    startHandler: () => onAction('CORRECT'),
    pauseHandler: () => onAction(resync.paused ? 'RESUME' : 'PAUSE'),
    cancelHandler: () => onAction('CANCEL'),
  };
}
