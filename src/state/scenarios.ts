import type { AppState } from './appReducer';
import type { Scenario } from '../types';

/**
 * Demo-only scenario presets, matching the ScenarioSwitcher control.
 * Delete alongside ScenarioSwitcher.tsx once wired to a real backend.
 */
export function applyScenario(state: AppState, scenario: Scenario): AppState {
  const base = {
    ...state,
    scenario,
    arrayStarted: true,
    selectedDiskId: null,
    actionNote: null,
  };

  if (scenario === 'degraded') {
    return { ...base, parity: { running: false, paused: false, progressPct: 0 } };
  }
  if (scenario === 'paritycheck') {
    return { ...base, parity: { running: true, paused: false, progressPct: 47 } };
  }
  return { ...base, scenario: 'healthy', parity: { running: false, paused: false, progressPct: 100 } };
}
