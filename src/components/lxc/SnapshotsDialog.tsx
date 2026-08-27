import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { lxcApi } from '../../api/lxcApi';
import type { LxcRuntimeState, LxcSnapshot } from '../../types/lxcApi';

interface SnapshotsDialogProps {
  name: string;
  containerState: LxcRuntimeState;
  onClose: () => void;
  onDone: () => void;
}

export function SnapshotsDialog({ name, containerState, onClose, onDone }: SnapshotsDialogProps) {
  const { t } = useTranslation('lxc');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<LxcSnapshot[]>([]);

  const [comment, setComment] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingRestore, setConfirmingRestore] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [restoringAsNewFor, setRestoringAsNewFor] = useState<string | null>(null);
  const [newContainerName, setNewContainerName] = useState('');

  const refresh = () => {
    setStatus('loading');
    lxcApi
      .listSnapshots(name)
      .then((res) => {
        setSnapshots(res);
        setStatus('ready');
      })
      .catch((err) => {
        setLoadError((err as Error).message);
        setStatus('error');
      });
  };

  useEffect(refresh, [name]);

  const resetRowState = () => {
    setConfirmingRestore(null);
    setConfirmingDelete(null);
    setRestoringAsNewFor(null);
    setNewContainerName('');
  };

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      await lxcApi.createSnapshot(name, comment.trim());
      setComment('');
      refresh();
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleRestoreInPlace = async (snapshotName: string) => {
    if (confirmingRestore !== snapshotName) {
      setConfirmingRestore(snapshotName);
      return;
    }
    setPending(snapshotName);
    setActionError(null);
    try {
      await lxcApi.restoreSnapshot(name, snapshotName, name);
      resetRowState();
      onDone();
      refresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  const handleRestoreAsNew = async (snapshotName: string) => {
    const trimmed = newContainerName.trim();
    if (!trimmed) return;
    setPending(snapshotName);
    setActionError(null);
    try {
      await lxcApi.restoreSnapshot(name, snapshotName, trimmed);
      resetRowState();
      onDone();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  const handleDelete = async (snapshotName: string) => {
    if (confirmingDelete !== snapshotName) {
      setConfirmingDelete(snapshotName);
      return;
    }
    setPending(snapshotName);
    setActionError(null);
    try {
      await lxcApi.deleteSnapshot(name, snapshotName);
      resetRowState();
      refresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog lxc-create-dialog">
        <div className="dialog__head">
          <div className="dialog__title">{t('SnapshotsDialog.title', { name })}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('SnapshotsDialog.close')}>
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          <label className="form-field">
            <span className="form-field__label">{t('SnapshotsDialog.commentLabel')}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="history-input"
                style={{ flex: 1 }}
                disabled={creating || containerState === 'running'}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <button type="button" className="btn--primary" disabled={creating || containerState === 'running'} onClick={handleCreate}>
                {creating ? t('SnapshotsDialog.creating') : t('SnapshotsDialog.createSnapshot')}
              </button>
            </div>
            {containerState === 'running' && <span className="apps-field__hint">{t('SnapshotsDialog.stopFirstHint')}</span>}
          </label>

          {createError && <div className="status-note status-note--error">{createError}</div>}
          {actionError && <div className="status-note status-note--error">{actionError}</div>}

          {status === 'loading' && <div className="status-note">{t('SnapshotsDialog.loadingSnapshots')}</div>}
          {status === 'error' && <div className="status-note status-note--error">{loadError}</div>}

          {status === 'ready' && (
            <div className="list">
              {snapshots.length === 0 && <div className="status-note">{t('SnapshotsDialog.noSnapshots')}</div>}
              {snapshots.map((s) => (
                <div className="list-card" key={s.name}>
                  <div className="list-card__col--name">
                    <div className="list-card__title">{s.name}</div>
                    <div className="list-card__subtitle">{s.timestamp}</div>
                    {s.comment && <div className="list-card__subtitle">{s.comment}</div>}
                  </div>

                  {restoringAsNewFor === s.name ? (
                    <div className="list-card__actions" style={{ flexWrap: 'wrap' }}>
                      <input
                        className="history-input"
                        placeholder={t('SnapshotsDialog.newContainerNamePlaceholder')}
                        disabled={pending === s.name}
                        value={newContainerName}
                        onChange={(e) => setNewContainerName(e.target.value)}
                      />
                      <button type="button" className="btn" disabled={pending === s.name} onClick={resetRowState}>
                        {t('SnapshotsDialog.cancel')}
                      </button>
                      <button
                        type="button"
                        className="btn--primary"
                        disabled={pending === s.name || !newContainerName.trim()}
                        onClick={() => handleRestoreAsNew(s.name)}
                      >
                        {pending === s.name ? t('SnapshotsDialog.restoring') : t('SnapshotsDialog.createCopy')}
                      </button>
                    </div>
                  ) : (
                    <div className="list-card__actions" style={{ flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn"
                        disabled={pending !== null}
                        onClick={() => {
                          resetRowState();
                          setRestoringAsNewFor(s.name);
                        }}
                      >
                        {t('SnapshotsDialog.restoreAsNew')}
                      </button>
                      <button type="button" className="btn btn--danger" disabled={pending !== null} onClick={() => handleRestoreInPlace(s.name)}>
                        {pending === s.name ? t('SnapshotsDialog.restoring') : confirmingRestore === s.name ? t('SnapshotsDialog.confirm') : t('SnapshotsDialog.restoreInPlace')}
                      </button>
                      <button type="button" className="btn btn--danger" disabled={pending !== null} onClick={() => handleDelete(s.name)}>
                        {pending === s.name ? t('SnapshotsDialog.deleting') : confirmingDelete === s.name ? t('SnapshotsDialog.confirm') : t('SnapshotsDialog.delete')}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onClose}>
              {t('SnapshotsDialog.close')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
