import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { appsApi } from '../../api/appsApi';
import type { CaApp, InstalledInfo } from '../../types/appsApi';
import { AppIcon } from './AppIcon';

interface AppDetailPanelProps {
  name: string;
  repository: string;
  installed: InstalledInfo | null;
  onClose: () => void;
  onInstall: () => void;
  onViewNamespace: (namespace: string) => void;
}

function formatUnixSeconds(ts: number | undefined): string | null {
  if (!ts) return null;
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function namespaceOf(repository: string): string {
  return repository.split('/')[0] ?? repository;
}

export function AppDetailPanel({ name, repository, installed, onClose, onInstall, onViewNamespace }: AppDetailPanelProps) {
  const [app, setApp] = useState<CaApp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setApp(null);
    setError(null);
    appsApi
      .getApp(name, repository)
      .then((a) => mounted && setApp(a))
      .catch((err) => mounted && setError((err as Error).message));
    return () => {
      mounted = false;
    };
  }, [name, repository]);

  const namespace = namespaceOf(repository);
  const maintainer = app?.Maintainer || app?.Author;
  const added = formatUnixSeconds(app?.FirstSeen);
  const updated = formatUnixSeconds(app?.LastUpdate);

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="detail-panel apps-detail-panel">
        <div className="detail-panel__head">
          <div className="detail-panel__title">{name}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        {!app && !error && <div className="status-note">Loading…</div>}
        {error && <div className="status-note status-note--error">{error}</div>}

        {app && (
          <>
            <div className="apps-detail__identity">
              <AppIcon name={app.Name} icon={app.Icon ?? null} size={56} />
              <div className="apps-detail__namespace">{namespace}</div>
            </div>

            <div className="apps-detail__actions">
              {installed ? (
                <Link to="/docker" className="btn--primary" onClick={onClose}>
                  Manage in Docker
                </Link>
              ) : (
                <button type="button" className="btn--primary" onClick={onInstall}>
                  Install
                </button>
              )}
              {app.Support && (
                <a className="btn" href={app.Support} target="_blank" rel="noreferrer">
                  Support
                </a>
              )}
              {app.Project && (
                <a className="btn" href={app.Project} target="_blank" rel="noreferrer">
                  Source
                </a>
              )}
            </div>

            {installed && (
              <div className="detail-section">
                <div className="detail-section__title">Installed</div>
                <div className="detail-rows">
                  <div className="detail-row">
                    <span className="detail-row__label">Container</span>
                    <span className="detail-row__value">{installed.containerName}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-row__label">Status</span>
                    <span className="detail-row__value">{installed.state === 'running' ? 'Running' : 'Stopped'}</span>
                  </div>
                </div>
                {installed.updateAvailable && (
                  <div className="apps-update-note">
                    A different image is now in the template: {app.Repository} (currently running{' '}
                    {installed.installedRepository}). Remove the existing container from the Docker page, then
                    reinstall this template to update.
                  </div>
                )}
              </div>
            )}

            {app.Overview && <div className="apps-detail__overview">{app.Overview.replace(/\r\n/g, '\n').trim()}</div>}

            <div className="detail-section">
              <div className="detail-section__title">Details</div>
              <div className="detail-rows">
                <div className="detail-row">
                  <span className="detail-row__label">Application type</span>
                  <span className="detail-row__value">Docker</span>
                </div>
                {app.CategoryList && app.CategoryList.length > 0 && (
                  <div className="detail-row">
                    <span className="detail-row__label">Categories</span>
                    <span className="detail-row__value">{app.CategoryList.map((c) => c.replace(/-/g, ' ')).join(', ')}</span>
                  </div>
                )}
                <div className="detail-row">
                  <span className="detail-row__label">Repository</span>
                  <span className="detail-row__value">{app.Repository}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-row__label">Network</span>
                  <span className="detail-row__value">{app.Network || 'bridge'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-row__label">Privileged</span>
                  <span className="detail-row__value">{app.Privileged === 'true' ? 'Yes' : 'No'}</span>
                </div>
                {typeof app.stars === 'number' && (
                  <div className="detail-row">
                    <span className="detail-row__label">Docker Hub stars</span>
                    <span className="detail-row__value">{app.stars.toLocaleString()}</span>
                  </div>
                )}
                {typeof app.downloads === 'number' && (
                  <div className="detail-row">
                    <span className="detail-row__label">Downloads</span>
                    <span className="detail-row__value">{app.downloads.toLocaleString()}</span>
                  </div>
                )}
                {added && (
                  <div className="detail-row">
                    <span className="detail-row__label">Added</span>
                    <span className="detail-row__value">{added}</span>
                  </div>
                )}
                {updated && (
                  <div className="detail-row">
                    <span className="detail-row__label">Last update</span>
                    <span className="detail-row__value">{updated}</span>
                  </div>
                )}
                {app.License && (
                  <div className="detail-row">
                    <span className="detail-row__label">License</span>
                    <span className="detail-row__value">{app.License}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="detail-section">
              <div className="detail-section__title">Maintainer</div>
              <div className="apps-detail__maintainer">
                <span>{maintainer || namespace}</span>
                <button type="button" className="btn" onClick={() => onViewNamespace(namespace)}>
                  All apps
                </button>
              </div>
            </div>

            <div className="apps-detail__note">
              Catalog data from Community Applications — not vetted by this project. Review ports, volumes, and the
              image before installing.
            </div>
          </>
        )}
      </div>
    </>
  );
}
