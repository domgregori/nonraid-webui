import { deriveToggleButton } from '../../selectors/status';
import { useAppStore } from '../../state/useAppStore';
import { ArrayStatusPill } from './ArrayStatusPill';
import { ScenarioSwitcher } from './ScenarioSwitcher';

export function Header() {
  const { state, dispatch } = useAppStore();
  const toggleBtn = deriveToggleButton(state.arrayStarted);

  return (
    <div className="header">
      <div className="header__brand">
        <div className="header__logo">N</div>
        <div>
          <div className="header__title">nonraid</div>
          <div className="header__subtitle">nmdctl dashboard</div>
        </div>
      </div>

      <ScenarioSwitcher />

      <div className="header__status">
        <ArrayStatusPill />
        <button
          type="button"
          className="toggle-array-btn"
          onClick={() => dispatch({ type: 'TOGGLE_ARRAY' })}
          style={{ borderColor: toggleBtn.border, background: toggleBtn.bg, color: toggleBtn.fg }}
        >
          {toggleBtn.label}
        </button>
      </div>
    </div>
  );
}
