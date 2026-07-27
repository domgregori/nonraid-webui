import { COLORS, tint } from '../styles/colors';
import type { NmdStatusResponse } from '../types/nmdApi';

function isDegraded(status: NmdStatusResponse): boolean {
  return status.array.health.status === 'DEGRADED' || status.array.counters.missing > 0;
}

export function deriveArrayStatus(status: NmdStatusResponse | null) {
  if (!status) return { text: 'LOADING', color: COLORS.textDim, pillBg: tint(COLORS.textDim, 14) };

  const arrayStarted = status.array.state === 'STARTED';
  let text: string;
  let color: string;
  if (!arrayStarted) {
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
