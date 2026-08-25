import { useMemo, useState } from 'react';
import { AppCard } from '../components/apps/AppCard';
import { AppDetailPanel } from '../components/apps/AppDetailPanel';
import { InstallDialog } from '../components/apps/InstallDialog';
import { useApps } from '../hooks/useApps';
import type { AppSort, AppSummary } from '../types/appsApi';

const PAGE_SIZE = 60;

const SORT_OPTIONS: { value: AppSort; label: string }[] = [
  { value: 'trending', label: 'Trending' },
  { value: 'popular', label: 'Most downloaded' },
  { value: 'latest', label: 'Newly updated' },
  { value: 'new', label: 'New apps' },
];

type DisplayOrder = '' | 'newest' | 'oldest' | 'downloads' | 'rating';

const DISPLAY_ORDER_OPTIONS: { value: DisplayOrder; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'downloads', label: 'Downloads' },
  { value: 'rating', label: 'Rating' },
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
          <div className="page-title">Apps</div>
          <div className="eyebrow apps-eyebrow">
            {meta ? `${meta.appCount.toLocaleString()} templates` : '-'}
            {meta && ` · updated ${formatLastUpdated(meta)}`}
          </div>
        </div>
        <button type="button" className="btn" onClick={refresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh catalog'}
        </button>
      </div>

      <div className="apps-layout">
        <div className="apps-main">
          <div className="apps-toolbar">
            <input
              className="apps-search"
              type="text"
              placeholder="Search apps…"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
            <select className="apps-filter-select" value={filterValue} onChange={(e) => handleFilterChange(e.target.value)}>
              <option value="">All apps</option>
              <optgroup label="Sort by">
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={`sort:${opt.value}`}>
                    {opt.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Categories">
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
              <option value="">Order by…</option>
              {DISPLAY_ORDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {status === 'loading' && <div className="status-note">Loading catalog…</div>}
          {error && <div className="status-note status-note--error">{error}</div>}

          {status === 'ready' && visible.length === 0 && <div className="status-note">No apps match your search.</div>}

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
                Show more ({orderedApps.length - visibleCount} remaining)
              </button>
            </div>
          )}

          <div className="apps-attribution">
            Catalog data from{' '}
            <a href="https://github.com/Squidly271/community.applications" target="_blank" rel="noreferrer">
              Community Applications
            </a>
            , an independent, community-curated Docker app template repository. Templates are not vetted by this
            project - review the container's ports, volumes, and image before installing.
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
