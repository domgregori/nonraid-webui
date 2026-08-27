import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const TABS = [
  { to: '/', labelKey: 'NavTabs.dashboard' },
  { to: '/disks', labelKey: 'NavTabs.disks' },
  { to: '/shares', labelKey: 'NavTabs.pools' },
  { to: '/browse', labelKey: 'NavTabs.browse' },
  { to: '/users', labelKey: 'NavTabs.sharing' },
  { to: '/docker', labelKey: 'NavTabs.docker' },
  { to: '/lxc', labelKey: 'NavTabs.lxc' },
  { to: '/apps', labelKey: 'NavTabs.apps' },
  { to: '/history', labelKey: 'NavTabs.history' },
  { to: '/settings', labelKey: 'NavTabs.settings' },
];

export function NavTabs() {
  const { t } = useTranslation('layout');
  return (
    <div className="nav-tabs">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}
        >
          {t(tab.labelKey)}
        </NavLink>
      ))}
    </div>
  );
}
