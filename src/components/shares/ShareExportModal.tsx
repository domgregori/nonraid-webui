import { useState } from 'react';
import type { Share, ShareInput } from '../../types/sharesApi';

interface ShareExportModalProps {
  share: Share;
  onCancel: () => void;
  onSubmit: (input: ShareInput) => Promise<boolean>;
}

/** Turns SMB/NFS network access on or off for an existing pool — the counterpart to
 *  ShareFormModal, which no longer edits this. Submits the full ShareInput (name/disks/
 *  allocationMethod/description unchanged) since the update route replaces, not patches. */
export function ShareExportModal({ share, onCancel, onSubmit }: ShareExportModalProps) {
  const [smbEnabled, setSmbEnabled] = useState(share.protocols.includes('smb'));
  const [smbPublic, setSmbPublic] = useState(share.smb?.public ?? true);
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
    if (!ok) setError('Request failed — see the page error banner for details.');
  };

  return (
    <>
      <div className="detail-overlay" onClick={onCancel} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">Share &quot;{share.name}&quot;</div>
          <button type="button" className="detail-panel__close" onClick={onCancel} aria-label="Close">
            &#10005;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="dialog__body">
          <div className="toggle-row__desc">
            Choose how the &quot;{share.name}&quot; pool is reachable over the network. Per-user SMB permissions are
            set on each user's own page below.
          </div>

          <div className="form-field">
            <label className="disk-checkbox">
              <input type="checkbox" checked={smbEnabled} onChange={(e) => setSmbEnabled(e.target.checked)} /> SMB
            </label>
            {smbEnabled && (
              <label className="disk-checkbox" style={{ marginLeft: 20 }}>
                <input type="checkbox" checked={smbPublic} onChange={(e) => setSmbPublic(e.target.checked)} /> Public (guest access)
              </label>
            )}
            <label className="disk-checkbox">
              <input type="checkbox" checked={nfsEnabled} onChange={(e) => setNfsEnabled(e.target.checked)} /> NFS
            </label>
            {nfsEnabled && (
              <div style={{ marginLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label className="disk-checkbox">
                  <input type="checkbox" checked={nfsReadOnly} onChange={(e) => setNfsReadOnly(e.target.checked)} /> Read-only
                </label>
                <label className="form-field">
                  <span className="form-field__label">Allowed hosts (comma-separated, * for any)</span>
                  <input className="history-input" style={{ width: '100%' }} value={nfsHosts} onChange={(e) => setNfsHosts(e.target.value)} />
                </label>
              </div>
            )}
          </div>

          {!smbEnabled && !nfsEnabled && (
            <div className="status-note">Not shared — this pool won't be reachable over the network until SMB or NFS is turned on.</div>
          )}

          {error && <div className="status-note status-note--error">{error}</div>}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn--primary" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
