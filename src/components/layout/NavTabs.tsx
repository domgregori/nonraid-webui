import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/', label: 'Dashboard' },
  { to: '/shares', label: 'Sharing' },
  { to: '/browse', label: 'Browse' },
  { to: '/users', label: 'Users' },
  { to: '/docker', label: 'Docker' },
  { to: '/history', label: 'History' },
  { to: '/settings', label: 'Settings' },
];

export function NavTabs() {
  return (
    <div className="nav-tabs">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  );
}
