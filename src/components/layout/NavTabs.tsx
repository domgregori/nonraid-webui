import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/', label: 'Dashboard' },
  { to: '/disks', label: 'Disks' },
  { to: '/shares', label: 'Pools' },
  { to: '/browse', label: 'Browse' },
  { to: '/users', label: 'Sharing' },
  { to: '/docker', label: 'Docker' },
  { to: '/lxc', label: 'LXC' },
  { to: '/apps', label: 'Apps' },
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
