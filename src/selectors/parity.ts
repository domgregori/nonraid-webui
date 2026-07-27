import type { Dispatch } from 'react';
import { COLORS } from '../styles/colors';
import type { AppAction } from '../state/actions';
import type { ParityState, ParityViewModel, Scenario } from '../types';

export function deriveParityViewModel(
  parity: ParityState,
  arrayStarted: boolean,
  scenario: Scenario,
  dispatch: Dispatch<AppAction>,
): ParityViewModel {
  const degraded = scenario === 'degraded';
  const canStart = arrayStarted && !parity.running;
  const progressPct = Math.round(parity.progressPct);
  const remainingMin = Math.max(0, Math.round(((100 - parity.progressPct) / 100) * 360));

  return {
    isRunning: parity.running,
    canStart,
    progressPct,
    barColor: degraded ? COLORS.red : COLORS.blue,
    progressLabel: parity.running
      ? `Checking: ${progressPct}%`
      : progressPct >= 100
        ? 'Last check: completed, 0 errors'
        : 'Last check: needs attention',
    speedText: parity.running && !parity.paused ? '152 MB/s' : '—',
    etaText: parity.running ? (parity.paused ? 'Paused' : `${remainingMin} min remaining`) : '—',
    pauseLabel: parity.paused ? 'Resume' : 'Pause',
    startHandler: () => dispatch({ type: 'START_PARITY' }),
    pauseHandler: () => dispatch({ type: 'TOGGLE_PAUSE_PARITY' }),
    cancelHandler: () => dispatch({ type: 'CANCEL_PARITY' }),
  };
}
