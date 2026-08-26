import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Share, ShareInput } from '../../types/sharesApi';

interface ShareExportModalProps {
  share: Share;
  onCancel: () => void;
  onSubmit: (input: ShareInput) => Promise<boolean>;
}

/** Turns SMB/NFS network access on or off for an existing pool - the counterpart to
 *  ShareFormModal, which no longer edits this. Submits the full ShareInput (name/disks/
 *  allocationMethod/description unchanged) since the update route replaces, not patches. */
export function ShareExportModal({ share, onCancel, onSubmit }: ShareExportModalProps) {
  const { t } = useTranslation('shares');
  const [smbEnabled, setSmbEnabled] = useState(share.protocols.includes('smb'));
  const [smbPublic, setSmbPublic] = useState(share.smb?.public ?? false);
  const [nfsEnabled, setNfsEnabled] = useState(share.protocols.includes('nfs'));
  const [nfsReadOnly, setNfsReadOnly] = useState(share.nfs?.readOnly ?? false);
  const [nfsHosts, setNfsHosts] = useState(share.nfs?.allowedHosts?.join(', ') ?? '*');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const input: ShareInput = {
      name: share.name,
      disks: share.disks,
      allDisks: share.allDisks,
      allocationMethod: share.allocationMethod,
      protocols: [...(smbEnabled ? (['smb'] as const) : []), ...(nfsEnabled ? (['nfs'] as const) : [])],
      smb: smbEnabled ? { public: smbPublic } : undefined,
      nfs: nfsEnabled
        ? { readOnly: nfsReadOnly, allowedHosts: nfsHosts.split(',').map((h) => h.trim()).filter(Boolean) }
        : undefined,
      description: share.description,
    };

    setSubmitting(true);
    const ok = await onSubmit(input);
    setSubmitting(false);
    if (!ok) setError(t('ShareExportModal.requestFailed'));
  };

  return (
    <>
      <div className="detail-overlay" onClick={onCancel} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{t('ShareExportModal.dialogTitle', { name: share.name })}</div>
          <button type="button" className="detail-panel__close" onClick={onCancel} aria-label={t('ShareExportModal.close')}>
            &#10005;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="dialog__body">
          <div className="toggle-row__desc">
            {t('ShareExportModal.desc', { name: share.name })}
          </div>

          <div className="form-field">
            <label className="disk-checkbox">
              <input type="checkbox" checked={smbEnabled} onChange={(e) => setSmbEnabled(e.target.checked)} /> {t('ShareExportModal.smb')}
            </label>
            {smbEnabled && (
              <label className="disk-checkbox" style={{ marginLeft: 20 }}>
                <input type="checkbox" checked={smbPublic} onChange={(e) => setSmbPublic(e.target.checked)} /> {t('ShareExportModal.smbPublic')}
              </label>
            )}
            <label className="disk-checkbox">
              <input type="checkbox" checked={nfsEnabled} onChange={(e) => setNfsEnabled(e.target.checked)} /> {t('ShareExportModal.nfs')}
            </label>
            {nfsEnabled && (
              <div style={{ marginLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label className="disk-checkbox">
                  <input type="checkbox" checked={nfsReadOnly} onChange={(e) => setNfsReadOnly(e.target.checked)} /> {t('ShareExportModal.nfsReadOnly')}
                </label>
                <label className="form-field">
                  <span className="form-field__label">{t('ShareExportModal.allowedHostsLabel')}</span>
                  <input className="history-input" style={{ width: '100%' }} value={nfsHosts} onChange={(e) => setNfsHosts(e.target.value)} />
                </label>
              </div>
            )}
          </div>

          {!smbEnabled && !nfsEnabled && (
            <div className="status-note">{t('ShareExportModal.notSharedNote')}</div>
          )}
          {smbEnabled && !smbPublic && (
            <div className="status-note">
              {t('ShareExportModal.notPublicNote')}
            </div>
          )}

          {error && <div className="status-note status-note--error">{error}</div>}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onCancel}>
              {t('ShareExportModal.cancel')}
            </button>
            <button type="submit" className="btn--primary" disabled={submitting}>
              {submitting ? t('ShareExportModal.saving') : t('ShareExportModal.save')}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
