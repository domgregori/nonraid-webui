import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cloudflaredApi } from '../../api/cloudflaredApi';
import { shareLinksApi } from '../../api/shareLinksApi';
import type { ShareLink, ShareMode } from '../../types/shareLinksApi';

interface ShareLinkModalProps {
  rootPath: string;
  defaultLabel: string;
  // null = creating a brand-new share for rootPath; a record = editing/managing an existing one
  // (Browse only ever passes a non-revoked, non-expired match for this exact path - see
  // BrowsePage.tsx's own lookup).
  existing: ShareLink | null;
  onClose: () => void;
  // Called after a create/update/revoke actually lands, so Browse's own "does a share already
  // exist for this path" list is fresh the next time this modal (or the toolbar button) reads it.
  onChanged: () => void;
}

function mbToBytes(mb: string): number | null {
  const n = Number(mb);
  return mb.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 1024 * 1024) : null;
}

function bytesToMb(bytes: number | null): string {
  return bytes === null ? '' : String(bytes / (1024 * 1024));
}

function shareUrl(publicUrl: string, token: string): string {
  const base = publicUrl.trim().replace(/\/+$/, '');
  return base ? `${base}/${token}` : token;
}

function toDatetimeLocal(ts: number | null): string {
  if (ts === null) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Create-or-edit form for a share link, opened from the Browse page for whatever file/folder the
 * admin is already looking at. No step-up here (see routes/shareLinks.ts) - a normal session is
 * enough, same as every other mutating action in this app. The share's own URL is always visible
 * and copyable, not a one-time reveal - see types/shareLinksApi.ts's ShareLink.token doc comment
 * for why that's fine (the token's own entropy is what resists guessing, not a hash's
 * irreversibility, so there's no reason to hide it from the admin who created it).
 */
export function ShareLinkModal({ rootPath, defaultLabel, existing, onClose, onChanged }: ShareLinkModalProps) {
  const { t } = useTranslation('browse');
  const [record, setRecord] = useState<ShareLink | null>(existing);
  const [label, setLabel] = useState(existing?.label ?? defaultLabel);
  const [mode, setMode] = useState<ShareMode>(existing?.mode ?? 'read-only');
  const [allowDelete, setAllowDelete] = useState(existing?.allowDelete ?? false);
  const [passwordDraft, setPasswordDraft] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [expiresAtDraft, setExpiresAtDraft] = useState(toDatetimeLocal(existing?.expiresAt ?? null));
  const [uploadQuotaMb, setUploadQuotaMb] = useState(bytesToMb(existing?.uploadQuotaBytes ?? null));
  const [maxFileSizeMb, setMaxFileSizeMb] = useState(bytesToMb(existing?.maxFileSizeBytes ?? null));
  const [publicUrl, setPublicUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingUnshare, setConfirmingUnshare] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cloudflaredApi
      .getStatus()
      .then((s) => setPublicUrl(s.publicUrl))
      .catch(() => {});
  }, []);

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const expiresAt = expiresAtDraft ? new Date(expiresAtDraft).getTime() : null;
      const uploadQuotaBytes = mbToBytes(uploadQuotaMb);
      const maxFileSizeBytes = mbToBytes(maxFileSizeMb);
      if (record) {
        const updated = await shareLinksApi.update(record.id, {
          label: label.trim() || null,
          mode,
          allowDelete,
          expiresAt,
          uploadQuotaBytes,
          maxFileSizeBytes,
          password: clearPassword ? null : passwordDraft ? passwordDraft : undefined,
        });
        setRecord(updated);
        setPasswordDraft('');
        setClearPassword(false);
      } else {
        const created = await shareLinksApi.create({
          rootPath,
          mode,
          label: label.trim() || undefined,
          allowDelete,
          password: passwordDraft || undefined,
          expiresAt,
          uploadQuotaBytes,
          maxFileSizeBytes,
        });
        setRecord(created);
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const unshare = async () => {
    if (!record) return;
    setSaving(true);
    setError(null);
    try {
      await shareLinksApi.update(record.id, { revoked: true });
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{record ? t('ShareLinkModal.editTitle') : t('ShareLinkModal.title')}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('ShareLinkModal.close')}>
            &#10005;
          </button>
        </div>
        <div className="dialog__body">
          <div className="status-note">{rootPath}</div>

          {record && (
            <div className="settings-field__row" style={{ marginTop: 12 }}>
              <input className="history-input" style={{ width: '100%' }} readOnly value={shareUrl(publicUrl, record.token)} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn" onClick={() => copy(shareUrl(publicUrl, record.token))}>
                {copied ? t('ShareLinkModal.copied') : t('ShareLinkModal.copy')}
              </button>
            </div>
          )}
          {record && !publicUrl && <div className="status-note">{t('ShareLinkModal.noPublicUrlHint')}</div>}

          <label className="ps-field settings-field__row" style={{ display: 'block', marginTop: 12 }}>
            <div className="toggle-row__title">{t('ShareLinkModal.label')}</div>
            <input className="history-input" style={{ width: '100%' }} value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>

          <div className="toggle-row__title" style={{ marginTop: 12 }}>
            {t('ShareLinkModal.mode')}
          </div>
          <div className="settings-field__row">
            <select className="history-input" value={mode} onChange={(e) => setMode(e.target.value as ShareMode)}>
              <option value="read-only">{t('ShareLinkModal.modeReadOnly')}</option>
              <option value="upload-only">{t('ShareLinkModal.modeUploadOnly')}</option>
              <option value="editable">{t('ShareLinkModal.modeEditable')}</option>
            </select>
          </div>
          <div className="toggle-row__desc">
            {mode === 'read-only' && t('ShareLinkModal.modeReadOnlyDesc')}
            {mode === 'upload-only' && t('ShareLinkModal.modeUploadOnlyDesc')}
            {mode === 'editable' && t('ShareLinkModal.modeEditableDesc')}
          </div>

          {mode === 'editable' && (
            <div className="toggle-row" style={{ marginTop: 8 }}>
              <div>
                <div className="toggle-row__title">{t('ShareLinkModal.allowDelete')}</div>
                <div className="toggle-row__desc">{t('ShareLinkModal.allowDeleteDesc')}</div>
              </div>
              <input type="checkbox" checked={allowDelete} onChange={(e) => setAllowDelete(e.target.checked)} disabled />
            </div>
          )}

          <div className="toggle-row__title" style={{ marginTop: 12 }}>
            {t('ShareLinkModal.password')}
          </div>
          <div className="toggle-row__desc">{record ? t('ShareLinkModal.passwordEditDesc') : t('ShareLinkModal.passwordDesc')}</div>
          <div className="settings-field__row">
            <input
              className="history-input"
              style={{ width: '100%' }}
              type="password"
              value={passwordDraft}
              disabled={clearPassword}
              onChange={(e) => setPasswordDraft(e.target.value)}
              placeholder={record ? (record.hasPassword ? t('ShareLinkModal.passwordKeepCurrent') : t('ShareLinkModal.passwordPlaceholder')) : t('ShareLinkModal.passwordPlaceholder')}
            />
          </div>
          {record && record.hasPassword && (
            <label className="toggle-row" style={{ marginTop: 4 }}>
              <div className="toggle-row__desc">{t('ShareLinkModal.removePassword')}</div>
              <input
                type="checkbox"
                checked={clearPassword}
                onChange={(e) => {
                  setClearPassword(e.target.checked);
                  if (e.target.checked) setPasswordDraft('');
                }}
              />
            </label>
          )}

          <div className="toggle-row__title" style={{ marginTop: 12 }}>
            {t('ShareLinkModal.expires')}
          </div>
          <div className="settings-field__row">
            <input className="history-input" type="datetime-local" value={expiresAtDraft} onChange={(e) => setExpiresAtDraft(e.target.value)} />
          </div>

          {(mode === 'upload-only' || mode === 'editable') && (
            <>
              <div className="toggle-row__title" style={{ marginTop: 12 }}>
                {t('ShareLinkModal.uploadQuota')}
              </div>
              <div className="toggle-row__desc">{t('ShareLinkModal.uploadQuotaDesc')}</div>
              <div className="settings-field__row">
                <input
                  className="history-input"
                  type="number"
                  min="0"
                  value={uploadQuotaMb}
                  onChange={(e) => setUploadQuotaMb(e.target.value)}
                  placeholder={t('ShareLinkModal.unlimited')}
                />
                <span className="toggle-row__desc">{t('ShareLinkModal.mb')}</span>
              </div>

              <div className="toggle-row__title" style={{ marginTop: 12 }}>
                {t('ShareLinkModal.maxFileSize')}
              </div>
              <div className="toggle-row__desc">{t('ShareLinkModal.maxFileSizeDesc')}</div>
              <div className="settings-field__row">
                <input
                  className="history-input"
                  type="number"
                  min="0"
                  value={maxFileSizeMb}
                  onChange={(e) => setMaxFileSizeMb(e.target.value)}
                  placeholder={t('ShareLinkModal.unlimited')}
                />
                <span className="toggle-row__desc">{t('ShareLinkModal.mb')}</span>
              </div>
            </>
          )}

          {error && <div className="status-note status-note--error" style={{ marginTop: 12 }}>{error}</div>}

          <div className="dialog__actions">
            {record &&
              (confirmingUnshare ? (
                <>
                  <button type="button" className="btn" onClick={() => setConfirmingUnshare(false)} disabled={saving}>
                    {t('ShareLinkModal.cancel')}
                  </button>
                  <button type="button" className="btn btn--danger" onClick={unshare} disabled={saving}>
                    {t('ShareLinkModal.confirmUnshare')}
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn--danger" onClick={() => setConfirmingUnshare(true)} disabled={saving} style={{ marginRight: 'auto' }}>
                  {t('ShareLinkModal.unshare')}
                </button>
              ))}
            {!confirmingUnshare && (
              <>
                <button type="button" className="btn" onClick={onClose} disabled={saving}>
                  {t('ShareLinkModal.cancel')}
                </button>
                <button type="button" className="btn btn--primary" onClick={submit} disabled={saving}>
                  {record ? t('ShareLinkModal.saveChanges') : t('ShareLinkModal.create')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
