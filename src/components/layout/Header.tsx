import { Link } from 'react-router-dom';
import { deriveToggleButton } from '../../selectors/status';
import { useArrayStatus } from '../../state/useArrayStatus';
import { useAuth } from '../../state/useAuth';
import { ArrayStatusPill } from './ArrayStatusPill';
import { HeaderClock } from './HeaderClock';
import { HeaderSystemInfo } from './HeaderSystemInfo';
import { NotificationBell } from './NotificationBell';

export function Header() {
  const { status, arrayPending, toggleArray } = useArrayStatus();
  const { logout } = useAuth();
  const toggleBtn = deriveToggleButton(status);

  return (
    <div className="header">
      <div className="header__brand-group">
        <Link to="/" className="header__brand">
          <div className="header__title">NonRAID</div>
          <img src="/logo.png" alt="" className="header__logo" />
        </Link>
        <HeaderClock />
      </div>

      <HeaderSystemInfo />

      <div className="header__status">
        <ArrayStatusPill />
        <button
          type="button"
          className="toggle-array-btn"
          disabled={!status || arrayPending}
          onClick={() => toggleArray()}
          style={{ borderColor: toggleBtn.border, background: toggleBtn.bg, color: toggleBtn.fg }}
        >
          {toggleBtn.label}
        </button>
        <NotificationBell />
        <button type="button" className="btn" onClick={() => logout()}>
          Log out
        </button>
      </div>
    </div>
  );
}
