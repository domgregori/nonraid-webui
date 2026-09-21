import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cloudflaredApi } from '../../api/cloudflaredApi';
import { shareLinksApi } from '../../api/shareLinksApi';
import type { CreatedShareLink, ShareMode } from '../../types/shareLinksApi';
import { StepUpModal } from '../shared/StepUpModal';

interface ShareLinkModalProps {
  rootPath: string;
  defaultLabel: string;
  onClose: () => void;
}

function mbToBytes(mb: string): number | null {
  const n = Number(mb);
  return mb.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 1024 * 1024) : null;
}

function shareUrl(publicUrl: string, token: string): string {
  const base = publicUrl.trim().replace(/\/+$/, '');
  return base ? `${base}/${token}` : token;
}

/**
 * Create-a-share-link form, opened from the Browse page for whatever file/folder the admin is
 * already looking at (rootPath). Mode picker drives which of the two follow-on field groups show
 * (allow_delete only under editable; the two upload-limit fields - cumulative quota vs. per-file
 * cap, independently optional - only under upload-only/editable), matching the plan's explicit
 * "not bundled into one setting" requirement. Submission itself goes through the shared
 * StepUpModal (same shell SshKeysSection.tsx's add-key flow uses), since POST /api/share-links is
 * requireStepUp-gated server-side.
 */
export function ShareLinkModal({ rootPath, defaultLabel, onClose }: ShareLinkModalProps) {
  const { t } = useTranslation('browse');
  const [label, setLabel] = useState(defaultLabel);
  const [mode, setMode] = useState<ShareMode>('read-only');
  const [allowDelete, setAllowDelete] = useState(false);
  const [password, setPassword] = useState('');
  const [expiresAtDraft, setExpiresAtDraft] = useState('');
  const [uploadQuotaMb, setUploadQuotaMb] = useState('');
  const [maxFileSizeMb, setMaxFileSizeMb] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [created, setCreated] = useState<CreatedShareLink | null>(null);
  const [publicUrl, setPublicUrl] = useState('');
  const [copied, setCopied] = useState(false);

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

  if (created) {
    const url = shareUrl(publicUrl, created.token);
    return (
      <>
        <div className="detail-overlay" onClick={onClose} />
        <div className="dialog">
          <div className="dialog__head">
            <div className="dialog__title">{t('ShareLinkModal.createdTitle')}</div>
            <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('ShareLinkModal.close')}>
              &#10005;
            </button>
          </div>
          <div className="dialog__body">
            <div className="status-note status-note--error">{t('ShareLinkModal.tokenWarning')}</div>
            <div className="settings-field__row" style={{ marginTop: 12 }}>
              <input className="history-input" style={{ width: '100%' }} readOnly value={url} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn" onClick={() => copy(url)}>
                {copied ? t('ShareLinkModal.copied') : t('ShareLinkModal.copy')}
              </button>
            </div>
            {!publicUrl && <div className="status-note">{t('ShareLinkModal.noPublicUrlHint')}</div>}
            <div className="dialog__actions">
              <button type="button" className="btn btn--primary" onClick={onClose}>
                {t('ShareLinkModal.done')}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{t('ShareLinkModal.title')}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('ShareLinkModal.close')}>
            &#10005;
          </button>
        </div>
        <div className="dialog__body">
          <div className="status-note">{rootPath}</div>

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
          <div className="toggle-row__desc">{t('ShareLinkModal.passwordDesc')}</div>
          <div className="settings-field__row">
            <input
              className="history-input"
              style={{ width: '100%' }}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('ShareLinkModal.passwordPlaceholder')}
            />
          </div>

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

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onClose}>
              {t('ShareLinkModal.cancel')}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => setConfirming(true)}>
              {t('ShareLinkModal.create')}
            </button>
          </div>
        </div>
      </div>

      {confirming && (
        <StepUpModal
          title={t('ShareLinkModal.confirmItsYou')}
          description={t('ShareLinkModal.confirmDesc')}
          confirmLabel={t('ShareLinkModal.create')}
          onClose={() => setConfirming(false)}
          onConfirm={async (currentPassword, totpCode) => {
            const result = await shareLinksApi.create(
              {
                rootPath,
                mode,
                label: label.trim() || undefined,
                allowDelete,
                password: password || undefined,
                expiresAt: expiresAtDraft ? new Date(expiresAtDraft).getTime() : null,
                uploadQuotaBytes: mbToBytes(uploadQuotaMb),
                maxFileSizeBytes: mbToBytes(maxFileSizeMb),
              },
              currentPassword,
              totpCode,
            );
            setCreated(result);
          }}
        />
      )}
    </>
  );
}
