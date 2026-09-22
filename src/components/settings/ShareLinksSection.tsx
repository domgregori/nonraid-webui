import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cloudflaredApi } from '../../api/cloudflaredApi';
import { shareLinksApi } from '../../api/shareLinksApi';
import type { ShareLink, ShareMode } from '../../types/shareLinksApi';

function shareUrl(publicUrl: string, token: string): string {
  const base = publicUrl.trim().replace(/\/+$/, '');
  return base ? `${base}/${token}` : token;
}

const MODE_LABEL_KEY: Record<ShareMode, string> = {
  'read-only': 'modeReadOnly',
  'upload-only': 'modeUploadOnly',
  editable: 'modeEditable',
};

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

/** List + revoke - creation happens from the Browse page's own ShareLinkModal (a share link is
 *  scoped to a folder/file the admin is already looking at there, not something this settings
 *  section itself constructs). Revoke is a plain PATCH, not step-up gated (see
 *  api/shareLinksApi.ts's own doc comment - it only ever narrows access). */
export function ShareLinksSection() {
  const { t } = useTranslation('settings');
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  const load = () =>
    shareLinksApi
      .list()
      .then(setLinks)
      .catch((err) => setLoadError((err as Error).message));

  useEffect(() => {
    load();
  }, []);

  const revoke = async (link: ShareLink) => {
    setBusyId(link.id);
    setActionError(null);
    try {
      await shareLinksApi.update(link.id, { revoked: !link.revokedAt });
      await load();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (loadError) return <div className="status-note status-note--error">{loadError}</div>;
  if (!links) return <div className="status-note">{t('ShareLinksSection.loading')}</div>;

  return (
    <div className="settings-field">
      <div className="toggle-row__title">{t('ShareLinksSection.title')}</div>
      <div className="toggle-row__desc">{t('ShareLinksSection.desc')}</div>

      {links.length === 0 && <div className="status-note">{t('ShareLinksSection.none')}</div>}

      {links.length > 0 && (
        <div className="remote-list">
          {links.map((link) => {
            const expired = link.expiresAt !== null && link.expiresAt < Date.now();
            const inactive = link.revokedAt !== null || expired;
            return (
              <div className="remote-row" key={link.id}>
                <div className="remote-row__body">
                  <div className="remote-row__name">
                    {link.label || t('ShareLinksSection.untitled')} · {t(`ShareLinksSection.${MODE_LABEL_KEY[link.mode]}`)}
                    {inactive && <span className="status-note status-note--error" style={{ marginLeft: 8 }}>{link.revokedAt ? t('ShareLinksSection.revoked') : t('ShareLinksSection.expired')}</span>}
                  </div>
                  <div className="remote-row__meta">
                    {link.rootPath}
                    {link.hasPassword && ` · ${t('ShareLinksSection.passwordProtected')}`}
                    {link.uploadQuotaBytes !== null || link.maxFileSizeBytes !== null
                      ? ` · ${t('ShareLinksSection.used')} ${formatBytes(link.uploadUsedBytes)} / ${formatBytes(link.uploadQuotaBytes)}`
                      : ''}
                    {link.expiresAt !== null && ` · ${t('ShareLinksSection.expires')} ${new Date(link.expiresAt).toLocaleString()}`}
                  </div>
                </div>
                <div className="remote-row__actions">
                  {!inactive && (
                    <button type="button" className="btn" onClick={() => copy(link)}>
                      {copiedId === link.id ? t('ShareLinksSection.copied') : t('ShareLinksSection.copy')}
                    </button>
                  )}
                  <button type="button" className={`btn${link.revokedAt ? '' : ' btn--danger'}`} disabled={busyId === link.id} onClick={() => revoke(link)}>
                    {link.revokedAt ? t('ShareLinksSection.unrevoke') : t('ShareLinksSection.revoke')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {actionError && <div className="status-note status-note--error">{actionError}</div>}
    </div>
  );
}
