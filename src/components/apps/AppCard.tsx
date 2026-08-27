import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('apps');
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
          <span className="app-card__privileged" title={t('AppCard.privilegedTooltip')}>
            {t('AppCard.privilegedBadge')}
          </span>
        )}
        {app.installed && (
          <span className={`app-card__installed${updateAvailable ? ' app-card__installed--update' : ''}`}>
            {updateAvailable ? t('AppCard.updateAvailable') : t('AppCard.installed')}
          </span>
        )}
      </div>

      {app.overviewShort && <div className="app-card__overview">{app.overviewShort}</div>}

      {hasStats && (
        <div className="app-card__stats">
          {app.downloads !== null && (
            <span title={t('AppCard.downloadsTooltip', { count: app.downloads.toLocaleString() })}>
              {t('AppCard.downloads', { count: app.downloads, formatted: compactNumber.format(app.downloads) })}
            </span>
          )}
          {app.stars !== null && (
            <span title={t('AppCard.starsTooltip', { count: app.stars.toLocaleString() })}>
              {t('AppCard.stars', { count: app.stars, formatted: compactNumber.format(app.stars) })}
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
          {app.installed ? (updateAvailable ? t('AppCard.update') : t('AppCard.edit')) : t('AppCard.install')}
        </button>
      </div>
    </div>
  );
}
