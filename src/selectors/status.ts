import { COLORS, tint } from '../styles/colors';
import type { ParityState, Scenario } from '../types';

export function deriveArrayStatus(arrayStarted: boolean, scenario: Scenario, parity: ParityState) {
  const degraded = scenario === 'degraded';
  let text: string;
  let color: string;
  if (!arrayStarted) {
    text = 'STOPPED';
    color = COLORS.textDim;
  } else if (degraded) {
    text = 'DEGRADED';
    color = COLORS.red;
  } else if (parity.running) {
    text = 'PARITY CHECK';
    color = COLORS.amber;
  } else {
    text = 'STARTED';
    color = COLORS.green;
  }
  return { text, color, pillBg: tint(color, 14) };
}

export function deriveProtection(scenario: Scenario, arrayStarted: boolean) {
  const degraded = scenario === 'degraded';
  const short = !arrayStarted ? 'Stopped' : degraded ? 'Degraded' : 'Dual Parity';
  const color = !arrayStarted ? COLORS.textDim : degraded ? COLORS.red : COLORS.green;
  const text = !arrayStarted
    ? 'Array stopped — all disks unmounted.'
    : degraded
      ? 'Disk 5 is missing. Data is emulated from parity — replace the disk to restore full protection.'
      : 'Both parity disks active — array can survive up to two simultaneous disk failures.';
  return { short, color, text };
}

export function deriveToggleButton(arrayStarted: boolean) {
  const label = arrayStarted ? 'Stop Array' : 'Start Array';
  const bg = arrayStarted ? tint(COLORS.red, 15) : COLORS.green;
  const fg = arrayStarted ? COLORS.red : COLORS.bg;
  const border = arrayStarted ? COLORS.red : COLORS.green;
  return { label, bg, fg, border };
}
