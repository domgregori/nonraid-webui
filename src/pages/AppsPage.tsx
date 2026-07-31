import { useState } from 'react';
import { AppCard } from '../components/apps/AppCard';
import { AppDetailPanel } from '../components/apps/AppDetailPanel';
import { InstallDialog } from '../components/apps/InstallDialog';
import { useApps } from '../hooks/useApps';
import type { AppSort, AppSummary } from '../types/appsApi';

const PAGE_SIZE = 60;

const SORT_OPTIONS: { value: AppSort; label: string }[] = [
  { value: 'trending', label: 'Trending' },
  { value: 'latest', label: 'Newly updated' },
  { value: 'new', label: 'New apps' },
];

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

  const visible = apps.slice(0, visibleCount);
  const hasMore = visibleCount < apps.length;

  const handleSearch = (value: string) => {
    setSearch(value);
    setVisibleCount(PAGE_SIZE);
  };

  const handleCategory = (value: string) => {
    setSort(null);
    setCategory(value === category ? '' : value);
    setVisibleCount(PAGE_SIZE);
  };

  const handleSort = (value: AppSort) => {
    setCategory('');
    setSort(sort === value ? null : value);
    setVisibleCount(PAGE_SIZE);
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
            {meta ? `${meta.appCount.toLocaleString()} templates` : '—'}
            {meta && ` · updated ${formatLastUpdated(meta)}`}
          </div>
        </div>
        <button type="button" className="btn" onClick={refresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh catalog'}
        </button>
      </div>

      <div className="apps-layout">
        <aside className="apps-sidebar">
          <div className="apps-sidebar__title">Categories</div>
          <button
            type="button"
            className={`category-item${category === '' && sort === null ? ' category-item--active' : ''}`}
            onClick={() => handleCategory('')}
          >
            All
          </button>
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`category-item${sort === opt.value ? ' category-item--active' : ''}`}
              onClick={() => handleSort(opt.value)}
            >
              {opt.label}
            </button>
          ))}
          <div className="apps-sidebar__separator" />
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={`category-item${category === c ? ' category-item--active' : ''}`}
              onClick={() => handleCategory(c)}
            >
              {c.replace(/-/g, ' ')}
            </button>
          ))}
        </aside>

        <div className="apps-main">
          <div className="apps-toolbar">
            <input
              className="apps-search"
              type="text"
              placeholder="Search apps…"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
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
                Show more ({apps.length - visibleCount} remaining)
              </button>
            </div>
          )}

          <div className="apps-attribution">
            Catalog data from{' '}
            <a href="https://github.com/Squidly271/community.applications" target="_blank" rel="noreferrer">
              Community Applications
            </a>
            , an independent, community-curated template repository for Unraid. Templates are not vetted by this
            project — review the container's ports, volumes, and image before installing.
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
