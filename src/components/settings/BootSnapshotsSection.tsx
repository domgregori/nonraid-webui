import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { systemApi } from '../../api/systemApi';
import type { BootSnapshot } from '../../types/systemApi';
import { formatFileSize } from '../../utils/format';

/**
 * Browsable management for the read-only btrfs boot-disk snapshots tools/install-webui.sh's own
 * snapshot_before_update() already takes automatically before every install/update run - lets an
 * admin also make one on demand, see what's there (including how much space each actually costs -
 * see the exclusive/total size note below), and delete old ones. Deliberately no "reboot into
 * this" action: an earlier version had one, but confirmed live that GRUB's own one-shot next-boot
 * override doesn't reliably self-clear on this btrfs setup, leaving the host stuck rebooting into
 * the same snapshot until fixed by hand. Booting into a snapshot for real recovery is still
 * possible exactly the way it always was - manually, from the physical GRUB menu.
 */
export function BootSnapshotsSection() {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [btrfsRoot, setBtrfsRoot] = useState(true);
  const [snapshots, setSnapshots] = useState<BootSnapshot[]>([]);

  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const refresh = () => {
    setStatus('loading');
    systemApi
      .listBootSnapshots()
      .then((res) => {
        setBtrfsRoot(res.btrfsRoot);
        setSnapshots(res.snapshots);
        setStatus('ready');
      })
      .catch((err) => {
        setLoadError((err as Error).message);
        setStatus('error');
      });
  };

  useEffect(refresh, []);

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      await systemApi.createBootSnapshot(label.trim() || undefined);
      setLabel('');
      refresh();
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (confirmingDelete !== name) {
      setConfirmingDelete(name);
      setActionError(null);
      return;
    }
    setPending(name);
    setActionError(null);
    try {
      await systemApi.deleteBootSnapshot(name);
      setConfirmingDelete(null);
      refresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  if (status === 'loading') return <div className="status-note">{t('BootSnapshotsSection.loading')}</div>;
  if (status === 'error') return <div className="status-note status-note--error">{loadError}</div>;

  if (!btrfsRoot) {
    return <div className="status-note">{t('BootSnapshotsSection.notBtrfs')}</div>;
  }

  return (
    <>
      <div className="toggle-row__desc">{t('BootSnapshotsSection.desc')}</div>

      <div className="settings-field__row" style={{ marginTop: 6 }}>
        <input
          className="history-input"
          style={{ flex: 1 }}
          placeholder={t('BootSnapshotsSection.labelPlaceholder')}
          disabled={creating}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button type="button" className="btn" disabled={creating} onClick={handleCreate}>
          {creating ? t('BootSnapshotsSection.creating') : t('BootSnapshotsSection.createButton')}
        </button>
      </div>
      {createError && <div className="status-note status-note--error">{createError}</div>}
      {actionError && <div className="status-note status-note--error">{actionError}</div>}

      <div className="list" style={{ marginTop: 10 }}>
        {snapshots.length === 0 && <div className="status-note">{t('BootSnapshotsSection.noSnapshots')}</div>}
        {snapshots.map((s) => (
          <div className="list-card" key={s.name}>
            <div className="list-card__col--name">
              <div className="list-card__title">{s.label ?? s.name}</div>
              <div className="list-card__subtitle">
                {s.createdAtLocal} · {s.kind === 'pre-update' ? t('BootSnapshotsSection.preUpdateKind') : t('BootSnapshotsSection.manualKind')}
              </div>
              <div className="list-card__subtitle">
                {s.size ? t('BootSnapshotsSection.sizeLabel', { exclusive: formatFileSize(s.size.exclusiveBytes), total: formatFileSize(s.size.totalBytes) }) : t('BootSnapshotsSection.sizeUnknown')}
              </div>
              {!s.inGrubMenu && (
                <div className="list-card__subtitle" style={{ color: 'var(--color-amber)' }}>
                  {t('BootSnapshotsSection.noGrubEntry')}
                </div>
              )}
            </div>
            <div className="list-card__actions" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn--danger" disabled={pending !== null} onClick={() => handleDelete(s.name)}>
                {pending === s.name ? t('BootSnapshotsSection.deleting') : confirmingDelete === s.name ? t('BootSnapshotsSection.confirm') : t('BootSnapshotsSection.delete')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
