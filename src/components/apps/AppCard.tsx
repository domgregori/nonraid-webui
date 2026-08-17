import type { AppSummary } from '../../types/appsApi';
import { AppIcon } from './AppIcon';

interface AppCardProps {
  app: AppSummary;
  onInstall: () => void;
  onViewDetail: () => void;
}

const MAX_VISIBLE_CATEGORIES = 2;

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact' });

export function AppCard({ app, onInstall, onViewDetail }: AppCardProps) {
  const shownCategories = app.categories.slice(0, MAX_VISIBLE_CATEGORIES);
  const extraCount = app.categories.length - shownCategories.length;
  const updateAvailable = app.installed?.updateAvailable ?? false;
  const hasStats = app.downloads !== null || app.stars !== null;

  return (
    <div
      className="app-card"
      onClick={onViewDetail}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onViewDetail();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="app-card__head">
        <AppIcon name={app.name} icon={app.icon} />
        <div className="app-card__heading">
          <div className="app-card__name">{app.name}</div>
          <div className="app-card__repo">{app.repository}</div>
        </div>
        {app.privileged && (
          <span className="app-card__privileged" title="This template requests a privileged container">
            Privileged
          </span>
        )}
        {app.installed && (
          <span className={`app-card__installed${updateAvailable ? ' app-card__installed--update' : ''}`}>
            {updateAvailable ? 'Update available' : 'Installed'}
          </span>
        )}
      </div>

      {app.overviewShort && <div className="app-card__overview">{app.overviewShort}</div>}

      {hasStats && (
        <div className="app-card__stats">
          {app.downloads !== null && (
            <span title={`${app.downloads.toLocaleString()} downloads`}>
              {compactNumber.format(app.downloads)} download{app.downloads === 1 ? '' : 's'}
            </span>
          )}
          {app.stars !== null && (
            <span title={`${app.stars.toLocaleString()} stars`}>
              {compactNumber.format(app.stars)} star{app.stars === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}

      <div className="app-card__foot">
        <div className="app-card__categories">
          {shownCategories.map((c) => (
            <span className="category-tag" key={c}>
              {c.replace(/-/g, ' ')}
            </span>
          ))}
          {extraCount > 0 && <span className="category-tag category-tag--more">+{extraCount}</span>}
        </div>
        <button
          type="button"
          className="btn--primary-sm"
          onClick={(e) => {
            e.stopPropagation();
            if (app.installed) onViewDetail();
            else onInstall();
          }}
        >
          {app.installed ? (updateAvailable ? 'Update' : 'Edit') : 'Install'}
        </button>
      </div>
    </div>
  );
}
