import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

/**
 * Catalog fields typed as `string` aren't actually guaranteed to be one at
 * runtime - the feed is converted from community-maintained XML templates,
 * and some genuinely nest a field instead of using plain text (e.g. one real
 * template has `Maintainer: { WebPage: "https://..." }`). Rendering an
 * object directly as a React child throws an uncaught error with no error
 * boundary around it, which unmounts the *entire* page - not just this
 * panel - so every catalog value shown as text or used as a link goes
 * through this first rather than trusting the declared type.
 */
function asText(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  if (value && typeof value === 'object') {
    const firstString = Object.values(value as Record<string, unknown>).find((v) => typeof v === 'string');
    return (firstString as string | undefined) ?? null;
  }
  return null;
}

export function AppDetailPanel({ name, repository, installed, onClose, onInstall, onViewNamespace }: AppDetailPanelProps) {
  const { t } = useTranslation('apps');
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
  const maintainer = asText(app?.Maintainer) || asText(app?.Author);
  const added = formatUnixSeconds(app?.FirstSeen);
  const updated = formatUnixSeconds(app?.LastUpdate);
  const support = asText(app?.Support);
  const project = asText(app?.Project);
  const license = asText(app?.License);
  const network = asText(app?.Network);
  const repositoryText = asText(app?.Repository);
  const overview = asText(app?.Overview);

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="detail-panel">
        <div className="detail-panel__head">
          <div className="detail-panel__title">{name}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('AppDetailPanel.close')}>
            &#10005;
          </button>
        </div>

        {!app && !error && <div className="status-note">{t('AppDetailPanel.loading')}</div>}
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
                  {t('AppDetailPanel.manageInDocker')}
                </Link>
              ) : (
                <button type="button" className="btn--primary" onClick={onInstall}>
                  {t('AppDetailPanel.install')}
                </button>
              )}
              {support && (
                <a className="btn" href={support} target="_blank" rel="noreferrer">
                  {t('AppDetailPanel.support')}
                </a>
              )}
              {project && (
                <a className="btn" href={project} target="_blank" rel="noreferrer">
                  {t('AppDetailPanel.source')}
                </a>
              )}
            </div>

            {overview && <div className="apps-detail__overview">{overview.replace(/\r\n/g, '\n').trim()}</div>}

            <div className="detail-panel__body">
              {installed && (
                <div className="detail-card">
                  <div className="eyebrow">{t('AppDetailPanel.installedEyebrow')}</div>
                  <div className="detail-rows">
                    <div className="detail-row">
                      <span className="detail-row__label">{t('AppDetailPanel.containerLabel')}</span>
                      <span className="detail-row__value">{installed.containerName}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">{t('AppDetailPanel.statusLabel')}</span>
                      <span className="detail-row__value">{installed.state === 'running' ? t('AppDetailPanel.running') : t('AppDetailPanel.stopped')}</span>
                    </div>
                  </div>
                  {installed.updateAvailable && (
                    <div className="apps-update-note">
                      {t('AppDetailPanel.updateNote', { repo: repositoryText ?? repository, installedRepo: installed.installedRepository })}
                    </div>
                  )}
                </div>
              )}

              <div className="detail-card">
                <div className="eyebrow">{t('AppDetailPanel.detailsEyebrow')}</div>
                <div className="detail-rows">
                  <div className="detail-row">
                    <span className="detail-row__label">{t('AppDetailPanel.appTypeLabel')}</span>
                    <span className="detail-row__value">Docker</span>
                  </div>
                  {app.CategoryList && app.CategoryList.filter((c) => typeof c === 'string').length > 0 && (
                    <div className="detail-row">
                      <span className="detail-row__label">{t('AppDetailPanel.categoriesLabel')}</span>
                      <span className="detail-row__value">
                        {app.CategoryList.filter((c) => typeof c === 'string')
                          .map((c) => c.replace(/-/g, ' '))
                          .join(', ')}
                      </span>
                    </div>
                  )}
                  <div className="detail-row">
                    <span className="detail-row__label">{t('AppDetailPanel.repositoryLabel')}</span>
                    <span className="detail-row__value">{repositoryText ?? repository}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-row__label">{t('AppDetailPanel.networkLabel')}</span>
                    <span className="detail-row__value">{network || 'bridge'}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-row__label">{t('AppDetailPanel.privilegedLabel')}</span>
                    <span className="detail-row__value">{app.Privileged === 'true' ? t('AppDetailPanel.yes') : t('AppDetailPanel.no')}</span>
                  </div>
                  {typeof app.stars === 'number' && (
                    <div className="detail-row">
                      <span className="detail-row__label">{t('AppDetailPanel.dockerHubStarsLabel')}</span>
                      <span className="detail-row__value">{app.stars.toLocaleString()}</span>
                    </div>
                  )}
                  {typeof app.downloads === 'number' && (
                    <div className="detail-row">
                      <span className="detail-row__label">{t('AppDetailPanel.downloadsLabel')}</span>
                      <span className="detail-row__value">{app.downloads.toLocaleString()}</span>
                    </div>
                  )}
                  {added && (
                    <div className="detail-row">
                      <span className="detail-row__label">{t('AppDetailPanel.addedLabel')}</span>
                      <span className="detail-row__value">{added}</span>
                    </div>
                  )}
                  {updated && (
                    <div className="detail-row">
                      <span className="detail-row__label">{t('AppDetailPanel.lastUpdateLabel')}</span>
                      <span className="detail-row__value">{updated}</span>
                    </div>
                  )}
                  {license && (
                    <div className="detail-row">
                      <span className="detail-row__label">{t('AppDetailPanel.licenseLabel')}</span>
                      <span className="detail-row__value">{license}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="detail-card">
                <div className="eyebrow">{t('AppDetailPanel.maintainerEyebrow')}</div>
                <div className="apps-detail__maintainer">
                  <span>{maintainer || namespace}</span>
                  <button type="button" className="btn" onClick={() => onViewNamespace(namespace)}>
                    {t('AppDetailPanel.allApps')}
                  </button>
                </div>
              </div>
            </div>

            <div className="apps-detail__note">{t('AppDetailPanel.catalogNote')}</div>
          </>
        )}
      </div>
    </>
  );
}
