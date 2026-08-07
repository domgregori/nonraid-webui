import { deriveToggleButton } from '../../selectors/status';
import { useArrayStatus } from '../../state/useArrayStatus';
import { useAuth } from '../../state/useAuth';
import { ArrayStatusPill } from './ArrayStatusPill';
import { HeaderSystemInfo } from './HeaderSystemInfo';

export function Header() {
  const { status, arrayPending, toggleArray } = useArrayStatus();
  const { logout } = useAuth();
  const toggleBtn = deriveToggleButton(status);

  return (
    <div className="header">
      <div className="header__brand">
        <img src="/logo.png" alt="" className="header__logo" />
        <div className="header__title">nonraid</div>
      </div>

      <HeaderSystemInfo />

      <div className="header__status">
        <ArrayStatusPill />
        <button
          type="button"
          className="toggle-array-btn"
          disabled={!status || arrayPending}
          onClick={toggleArray}
          style={{ borderColor: toggleBtn.border, background: toggleBtn.bg, color: toggleBtn.fg }}
        >
          {toggleBtn.label}
        </button>
        <button type="button" className="btn" onClick={() => logout()}>
          Log out
        </button>
      </div>
    </div>
  );
}
