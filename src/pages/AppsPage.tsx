import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppCard } from '../components/apps/AppCard';
import { AppDetailPanel } from '../components/apps/AppDetailPanel';
import { InstallDialog } from '../components/apps/InstallDialog';
import { useApps } from '../hooks/useApps';
import type { AppSort, AppSummary } from '../types/appsApi';

const PAGE_SIZE = 60;

const SORT_OPTIONS: { value: AppSort; labelKey: string }[] = [
  { value: 'trending', labelKey: 'AppsPage.sortTrending' },
  { value: 'popular', labelKey: 'AppsPage.sortPopular' },
  { value: 'latest', labelKey: 'AppsPage.sortLatest' },
  { value: 'new', labelKey: 'AppsPage.sortNew' },
];

type DisplayOrder = '' | 'newest' | 'oldest' | 'downloads' | 'rating';

const DISPLAY_ORDER_OPTIONS: { value: DisplayOrder; labelKey: string }[] = [
  { value: 'newest', labelKey: 'AppsPage.orderNewest' },
  { value: 'oldest', labelKey: 'AppsPage.orderOldest' },
  { value: 'downloads', labelKey: 'AppsPage.orderDownloads' },
  { value: 'rating', labelKey: 'AppsPage.orderRating' },
];

// Independent of the category/sort dropdown above - re-orders whatever's currently in `apps`
// (the full already-fetched, already-filtered list, not just the paginated `visible` slice)
// purely client-side. No backend round trip: every field it sorts by (firstSeenAt, downloads,
// stars) already ships on AppSummary. Missing values always sort last, regardless of direction -
// an app the feed has no signal for isn't meaningfully "oldest" or "unrated", it's just unknown.
function applyDisplayOrder(apps: AppSummary[], order: DisplayOrder): AppSummary[] {
  if (!order) return apps;
  const sorted = [...apps];
  if (order === 'newest') sorted.sort((a, b) => (b.firstSeenAt ?? -Infinity) - (a.firstSeenAt ?? -Infinity));
  else if (order === 'oldest') sorted.sort((a, b) => (a.firstSeenAt ?? Infinity) - (b.firstSeenAt ?? Infinity));
  else if (order === 'downloads') sorted.sort((a, b) => (b.downloads ?? -Infinity) - (a.downloads ?? -Infinity));
  else if (order === 'rating') sorted.sort((a, b) => (b.stars ?? -Infinity) - (a.stars ?? -Infinity));
  return sorted;
}

function formatLastUpdated(meta: { lastUpdated: string } | null): string {
  if (!meta) return '';
  return meta.lastUpdated;
}

export function AppsPage() {
  const { t } = useTranslation('pages');
  const { apps, categories, meta, status, error, search, setSearch, category, setCategory, sort, setSort, refreshing, refresh } =
    useApps();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [installingApp, setInstallingApp] = useState<AppSummary | null>(null);
  const [viewingApp, setViewingApp] = useState<AppSummary | null>(null);
  // Independent of category/search/sort above - deliberately not reset when any of those change,
  // so picking e.g. "Downloads" keeps reordering whatever set of apps ends up displayed.
  const [displayOrder, setDisplayOrder] = useState<DisplayOrder>('');

  const orderedApps = useMemo(() => applyDisplayOrder(apps, displayOrder), [apps, displayOrder]);
  const visible = orderedApps.slice(0, visibleCount);
  const hasMore = visibleCount < orderedApps.length;

  const handleSearch = (value: string) => {
    setSearch(value);
    setVisibleCount(PAGE_SIZE);
  };

  // Sort and category are mutually exclusive server-side filters, but presented as one combined
  // dropdown - encode which kind a given selection is in the option value itself ("sort:trending",
  // "category:MediaServer:Video") since a category name could otherwise collide with a sort value.
  const filterValue = sort ? `sort:${sort}` : category ? `category:${category}` : '';

  const handleFilterChange = (value: string) => {
    setVisibleCount(PAGE_SIZE);
    if (value.startsWith('sort:')) {
      setSort(value.slice(5) as AppSort);
      setCategory('');
    } else if (value.startsWith('category:')) {
      setCategory(value.slice(9));
      setSort(null);
    } else {
      setSort(null);
      setCategory('');
    }
  };

  const handleViewNamespace = (namespace: string) => {
    setViewingApp(null);
    setSort(null);
    setCategory('');
    handleSearch(namespace);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">{t('AppsPage.title')}</div>
          <div className="eyebrow apps-eyebrow">
            {meta ? t('AppsPage.templateCount', { count: meta.appCount.toLocaleString() }) : '-'}
            {meta && ` · ${t('AppsPage.updatedLabel', { date: formatLastUpdated(meta) })}`}
          </div>
        </div>
        <button type="button" className="btn" onClick={refresh} disabled={refreshing}>
          {refreshing ? t('AppsPage.refreshing') : t('AppsPage.refreshCatalog')}
        </button>
      </div>

      <div className="apps-layout">
        <div className="apps-main">
          <div className="apps-toolbar">
            <input
              className="apps-search"
              type="text"
              placeholder={t('AppsPage.searchPlaceholder')}
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
            <select className="apps-filter-select" value={filterValue} onChange={(e) => handleFilterChange(e.target.value)}>
              <option value="">{t('AppsPage.allApps')}</option>
              <optgroup label={t('AppsPage.sortByGroup')}>
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={`sort:${opt.value}`}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t('AppsPage.categoriesGroup')}>
                {categories.map((c) => (
                  <option key={c} value={`category:${c}`}>
                    {c.replace(/-/g, ' ')}
                  </option>
                ))}
              </optgroup>
            </select>
            <select
              className="apps-filter-select"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value as DisplayOrder)}
            >
              <option value="">{t('AppsPage.orderByPlaceholder')}</option>
              {DISPLAY_ORDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </div>

          {status === 'loading' && <div className="status-note">{t('AppsPage.loadingCatalog')}</div>}
          {error && <div className="status-note status-note--error">{error}</div>}

          {status === 'ready' && visible.length === 0 && <div className="status-note">{t('AppsPage.noMatch')}</div>}

          <div className="apps-grid">
            {visible.map((app, i) => (
              <AppCard
                key={`${app.name}::${app.repository}::${i}`}
                app={app}
                onInstall={() => setInstallingApp(app)}
                onViewDetail={() => setViewingApp(app)}
              />
            ))}
          </div>

          {hasMore && (
            <div className="apps-load-more">
              <button type="button" className="btn" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
                {t('AppsPage.showMore', { count: orderedApps.length - visibleCount })}
              </button>
            </div>
          )}

          <div className="apps-attribution">
            {t('AppsPage.attributionPrefix')}{' '}
            <a href="https://github.com/Squidly271/community.applications" target="_blank" rel="noreferrer">
              {t('AppsPage.attributionLinkText')}
            </a>
            {t('AppsPage.attributionSuffix')}
          </div>
        </div>
      </div>

      {viewingApp && (
        <AppDetailPanel
          name={viewingApp.name}
          repository={viewingApp.repository}
          installed={viewingApp.installed}
          onClose={() => setViewingApp(null)}
          onInstall={() => {
            setInstallingApp(viewingApp);
            setViewingApp(null);
          }}
          onViewNamespace={handleViewNamespace}
        />
      )}

      {installingApp && (
        <InstallDialog appName={installingApp.name} repository={installingApp.repository} onClose={() => setInstallingApp(null)} />
      )}
    </div>
  );
}
