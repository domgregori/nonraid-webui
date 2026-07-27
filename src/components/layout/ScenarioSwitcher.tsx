import { useAppStore } from '../../state/useAppStore';
import type { Scenario } from '../../types';

/**
 * Demo-only control to preview array states without a real backend.
 * Remove this component (and the `scenario` field / SET_SCENARIO action)
 * once the dashboard is wired to real nmdctl status.
 */
const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: 'healthy', label: 'Healthy' },
  { key: 'degraded', label: 'Degraded' },
  { key: 'paritycheck', label: 'Parity Check' },
];

export function ScenarioSwitcher() {
  const { state, dispatch } = useAppStore();

  return (
    <div className="header__scenarios" data-devonly="true">
      {SCENARIOS.map((s) => {
        const active = s.key === state.scenario;
        return (
          <button
            key={s.key}
            type="button"
            className={`scenario-btn${active ? ' scenario-btn--active' : ''}`}
            onClick={() => dispatch({ type: 'SET_SCENARIO', scenario: s.key })}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
