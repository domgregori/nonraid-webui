import { COLORS, tint } from '../styles/colors';
import type { NmdStatusResponse } from '../types/nmdApi';

/**
 * A single-parity array's unused second-parity (Q) slot is permanently counted
 * as "invalid" + "disabled" by the driver's internal state (nmdctl's own status
 * output even warns about this: "Driver internal state is inconsistent ... but
 * all individual disks are DISK_OK status"). That makes nmdctl report DEGRADED
 * even when every real disk and parity are fine. Recognize that specific,
 * harmless pattern so the dashboard doesn't cry wolf.
 */
function isPhantomSecondParityGlitch(status: NmdStatusResponse): boolean {
  const { counters, size } = status.array;
  return (
    !size.has_second_parity &&
    counters.missing === 0 &&
    counters.wrong === 0 &&
    counters.replaced === 0 &&
    counters.new === 0 &&
    counters.invalid <= 1 &&
    counters.disabled <= 1 &&
    status.disks.every((d) => d.status === 'DISK_OK')
  );
}

export function isDegraded(status: NmdStatusResponse): boolean {
  if (status.array.counters.missing > 0) return true;
  if (status.array.health.status !== 'DEGRADED') return false;
  return !isPhantomSecondParityGlitch(status);
}

// The kernel driver itself bakes this prefix into the state name for the
// handful of states that mean something needs a human look (confirmed
// against md_unraid.c this session — TOO_MANY_MISSING_DISKS,
// INVALID_EXPANSION, PARITY_NOT_BIGGEST, NEW_DISK_TOO_SMALL, NO_DATA_DISKS —
// every other abnormal state doesn't carry it). Distinct from DEGRADED:
// this means the array likely isn't even running right now, not just
// running with reduced protection.
export function isArrayError(status: NmdStatusResponse): boolean {
  return status.array.state.startsWith('ERROR:');
}

export function deriveArrayStatus(status: NmdStatusResponse | null) {
  if (!status) return { text: 'LOADING', color: COLORS.textDim, pillBg: tint(COLORS.textDim, 14) };

  const arrayStarted = status.array.state === 'STARTED';
  let text: string;
  let color: string;
  if (isArrayError(status)) {
    text = 'ERROR';
    color = COLORS.red;
  } else if (!arrayStarted) {
    text = 'STOPPED';
    color = COLORS.textDim;
  } else if (isDegraded(status)) {
    text = 'DEGRADED';
    color = COLORS.red;
  } else if (status.resync.active) {
    text = 'PARITY CHECK';
    color = COLORS.amber;
  } else {
    text = 'STARTED';
    color = COLORS.green;
  }
  return { text, color, pillBg: tint(color, 14) };
}

export function deriveProtection(status: NmdStatusResponse | null) {
  if (!status) return { short: '—', color: COLORS.textDim, text: 'Loading array status…' };

  const arrayStarted = status.array.state === 'STARTED';
  if (!arrayStarted) {
    return { short: 'Stopped', color: COLORS.textDim, text: 'Array stopped — all disks unmounted.' };
  }

  if (isDegraded(status)) {
    const missing = status.array.counters.missing;
    return {
      short: 'Degraded',
      color: COLORS.red,
      text:
        status.array.health.details ||
        `${missing} disk${missing === 1 ? '' : 's'} missing. Data is emulated from parity — replace the disk to restore full protection.`,
    };
  }

  const { has_parity, has_second_parity } = status.array.size;
  if (has_second_parity) {
    return { short: 'Dual Parity', color: COLORS.green, text: 'Both parity disks active — array can survive up to two simultaneous disk failures.' };
  }
  if (has_parity) {
    return { short: 'Single Parity', color: COLORS.green, text: 'Parity disk active — array can survive one disk failure.' };
  }
  return { short: 'No Parity', color: COLORS.amber, text: 'No parity disk assigned — a disk failure means data loss.' };
}

export function deriveToggleButton(status: NmdStatusResponse | null) {
  const arrayStarted = status?.array.state === 'STARTED';
  const label = arrayStarted ? 'Stop Array' : 'Start Array';
  const bg = arrayStarted ? tint(COLORS.red, 15) : COLORS.green;
  const fg = arrayStarted ? COLORS.red : COLORS.bg;
  const border = arrayStarted ? COLORS.red : COLORS.green;
  return { label, bg, fg, border };
}
