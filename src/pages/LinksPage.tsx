import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShareLinkModal } from '../components/browse/ShareLinkModal';
import { cloudflaredApi } from '../api/cloudflaredApi';
import { shareLinksApi } from '../api/shareLinksApi';
import type { ShareLink, ShareMode } from '../types/shareLinksApi';

const MODE_LABEL_KEY: Record<ShareMode, string> = {
  'read-only': 'modeReadOnly',
  'upload-only': 'modeUploadOnly',
  editable: 'modeEditable',
};

function shareUrl(publicUrl: string, token: string): string {
  const base = publicUrl.trim().replace(/\/+$/, '');
  return base ? `${base}/${token}` : token;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '∞';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

function labelFor(rootPath: string): string {
  return rootPath.split('/').filter(Boolean).pop() ?? rootPath;
}

/** Every share link across the whole array, regardless of which folder it's rooted at - the
 *  Browse page only ever shows the one (if any) for whatever folder you're currently looking at,
 *  so this is the place to see and manage all of them at once. Creation still only happens from
 *  Browse (a share is scoped to a folder the admin is already looking at there); this page reuses
 *  the same ShareLinkModal for editing since a share's settings don't depend on which page opened
 *  the form. */
export function LinksPage() {
  const { t } = useTranslation('pages');
  const navigate = useNavigate();
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [managing, setManaging] = useState<ShareLink | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const load = useCallback(() => {
    shareLinksApi
      .list()
      .then(setLinks)
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    cloudflaredApi
      .getStatus()
      .then((s) => setPublicUrl(s.publicUrl))
      .catch(() => {});
  }, []);

  const copy = (link: ShareLink) => {
    navigator.clipboard?.writeText(shareUrl(publicUrl, link.token)).then(() => {
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const reactivate = async (link: ShareLink) => {
    setBusyId(link.id);
    setActionError(null);
    try {
      await shareLinksApi.update(link.id, { revoked: false });
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  // Backend refuses (409) to delete a share that's still live - revoke() above is the only way
  // to get here, so this never needs its own live/inactive check beyond that.
  const remove = async (link: ShareLink) => {
    setBusyId(link.id);
    setActionError(null);
    try {
      await shareLinksApi.remove(link.id);
      setConfirmingDeleteId(null);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const sorted = (links ?? []).slice().sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">{t('LinksPage.title')}</div>
      </div>

      <div className="toggle-row__desc" style={{ marginBottom: 'var(--space-lg)' }}>
        {t('LinksPage.desc')}
      </div>

      {links === null && !loadError && <div className="status-note">{t('LinksPage.loading')}</div>}
      {loadError && <div className="status-note status-note--error">{loadError}</div>}
      {actionError && <div className="status-note status-note--error">{actionError}</div>}
      {links !== null && links.length === 0 && <div className="status-note">{t('LinksPage.none')}</div>}

      {links !== null && links.length > 0 && (
        <div className="remote-list">
          {sorted.map((link) => {
            const expired = link.expiresAt !== null && link.expiresAt < Date.now();
            const revoked = link.revokedAt !== null;
            const inactive = revoked || expired;
            return (
              <div className="remote-row" key={link.id}>
                <div className="remote-row__body">
                  <div className="remote-row__name">
                    {link.label || t('LinksPage.untitled')} · {t(`LinksPage.${MODE_LABEL_KEY[link.mode]}`)}
                    {inactive && (
                      <span className="status-note status-note--error" style={{ marginLeft: 8 }}>
                        {revoked ? t('LinksPage.revoked') : t('LinksPage.expired')}
                      </span>
                    )}
                  </div>
                  <div className="remote-row__meta">
                    <button type="button" className="link-button" onClick={() => navigate('/browse', { state: { path: link.rootPath } })} title={t('LinksPage.openInBrowse')}>
                      {link.rootPath}
                    </button>
                    {link.hasPassword && ` · ${t('LinksPage.passwordProtected')}`}
                    {' · '}
                    {t('LinksPage.downloadCount', { count: link.downloadCount })}
                    {(link.uploadQuotaBytes !== null || link.maxFileSizeBytes !== null) &&
                      ` · ${t('LinksPage.used')} ${formatBytes(link.uploadUsedBytes)} / ${formatBytes(link.uploadQuotaBytes)}`}
                    {link.expiresAt !== null && ` · ${t('LinksPage.expires')} ${new Date(link.expiresAt).toLocaleString()}`}
                  </div>
                </div>
                <div className="remote-row__actions">
                  {!inactive && (
                    <button type="button" className="btn" onClick={() => copy(link)}>
                      {copiedId === link.id ? t('LinksPage.copied') : t('LinksPage.copy')}
                    </button>
                  )}
                  <button type="button" className="btn" onClick={() => setManaging(link)}>
                    {t('LinksPage.manage')}
                  </button>
                  {revoked && confirmingDeleteId !== link.id && (
                    <button type="button" className="btn" disabled={busyId === link.id} onClick={() => reactivate(link)}>
                      {t('LinksPage.reactivate')}
                    </button>
                  )}
                  {revoked &&
                    (confirmingDeleteId === link.id ? (
                      <>
                        <button type="button" className="btn" disabled={busyId === link.id} onClick={() => setConfirmingDeleteId(null)}>
                          {t('LinksPage.cancel')}
                        </button>
                        <button type="button" className="btn btn--danger" disabled={busyId === link.id} onClick={() => remove(link)}>
                          {t('LinksPage.confirmDelete')}
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn btn--danger" onClick={() => setConfirmingDeleteId(link.id)}>
                        {t('LinksPage.delete')}
                      </button>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {managing && (
        <ShareLinkModal
          rootPath={managing.rootPath}
          defaultLabel={labelFor(managing.rootPath)}
          existing={managing}
          onClose={() => setManaging(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
