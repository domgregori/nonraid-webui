import { useState } from 'react';
import { AppIcon } from '../components/apps/AppIcon';
import { ContainerFormDialog } from '../components/docker/ContainerFormDialog';
import { LogsDialog } from '../components/docker/LogsDialog';
import { useDockerContainers } from '../hooks/useDockerContainers';
import { deriveContainerViewModel } from '../selectors/containers';

type DialogState =
  | { mode: 'add' }
  | { mode: 'edit'; containerId: string }
  | { mode: 'logs'; containerId: string; containerName: string }
  | null;

export function DockerPage() {
  const {
    containers,
    status,
    error,
    pendingIds,
    updateStatus,
    checkingUpdates,
    start,
    stop,
    restart,
    destroy,
    setAutostart,
    checkContainerUpdate,
    checkAllUpdates,
    updateNow,
    refresh,
  } = useDockerContainers();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [confirmingDestroy, setConfirmingDestroy] = useState<string | null>(null);
  const [confirmingUpdate, setConfirmingUpdate] = useState<{ id: string; name: string } | null>(null);

  const handleDestroyClick = (id: string) => {
    if (confirmingDestroy === id) {
      destroy(id);
      setConfirmingDestroy(null);
    } else {
      setConfirmingDestroy(id);
    }
  };

  const handleConfirmUpdate = () => {
    if (!confirmingUpdate) return;
    updateNow(confirmingUpdate.id);
    setConfirmingUpdate(null);
  };

  const views = containers.map((c) =>
    deriveContainerViewModel(c, {
      isPending: pendingIds.has(c.id),
      updateAvailable: updateStatus[c.id]?.updateAvailable ?? null,
      onToggle: () => (c.state === 'running' ? stop(c.id) : start(c.id)),
      onRestart: () => restart(c.id),
      onEdit: () => setDialog({ mode: 'edit', containerId: c.id }),
      onViewLogs: () => setDialog({ mode: 'logs', containerId: c.id, containerName: c.name }),
      onDestroy: () => handleDestroyClick(c.id),
      onToggleAutostart: () => setAutostart(c.id, !c.autostart),
      onCheckUpdate: () => checkContainerUpdate(c.id),
      onUpdateNow: () => setConfirmingUpdate({ id: c.id, name: c.name }),
    }),
  );

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">Docker Containers</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" disabled={checkingUpdates} onClick={checkAllUpdates}>
            {checkingUpdates ? 'Checking…' : 'Check for updates'}
          </button>
          <button type="button" className="btn--primary" onClick={() => setDialog({ mode: 'add' })}>
            Add Container
          </button>
        </div>
      </div>

      {status === 'loading' && <div className="status-note">Loading containers…</div>}
      {error && <div className="status-note status-note--error">{error}</div>}

      <div className="docker-grid">
        {views.map((c) => (
          <div className="docker-card" key={c.id}>
            <div className="docker-card__head">
              <div className="docker-card__identity">
                <AppIcon name={c.name} icon={c.icon} size={32} />
                <div className="docker-card__name">{c.name}</div>
              </div>
              <span className="docker-card__status" style={{ color: c.statusColor }}>
                <span className="docker-card__status-dot" style={{ background: c.statusColor }} />
                {c.statusLabel}
              </span>
            </div>
            <div className="docker-card__image">{c.image}</div>
            <div className="docker-card__autostart-row">
              <label className="docker-card__autostart">
                <input type="checkbox" checked={c.autostart} disabled={c.isPending} onChange={c.onToggleAutostart} />
                Autostart
              </label>
            </div>
            <div className="docker-card__badges">
              {c.caAppName ? (
                <span className="docker-card__badge docker-card__badge--ca">CA: {c.caAppName}</span>
              ) : (
                <span className="docker-card__badge docker-card__badge--custom">Custom</span>
              )}
              {c.updateAvailable && <span className="docker-card__badge docker-card__badge--update">Update available</span>}
              {c.webUiUrl && (
                <a className="docker-card__weburl" href={c.webUiUrl} target="_blank" rel="noreferrer">
                  Web UI &#8599;
                </a>
              )}
            </div>
            <div className="docker-card__stats">
              <span>CPU {c.cpuLabel}</span>
              <span>Mem {c.memLabel}</span>
              <span>{c.ports}</span>
            </div>
            <div className="docker-card__actions">
              <button
                type="button"
                className="btn"
                disabled={c.isPending}
                style={{ borderColor: c.toggleBorder, background: c.toggleBg, color: c.toggleFg }}
                onClick={c.onToggle}
              >
                {c.toggleLabel}
              </button>
              <button type="button" className="btn" disabled={c.isPending} onClick={c.onRestart}>
                Restart
              </button>
            </div>
            <div className="docker-card__actions">
              <button type="button" className="btn" disabled={c.isPending} onClick={c.onViewLogs}>
                Logs
              </button>
              <button type="button" className="btn" disabled={c.isPending} onClick={c.onEdit}>
                Edit
              </button>
            </div>
            <div className="docker-card__actions">
              {c.updateAvailable ? (
                <button type="button" className="btn" disabled={c.isPending} onClick={c.onUpdateNow}>
                  Update Now
                </button>
              ) : (
                <button type="button" className="btn" disabled={c.isPending} onClick={c.onCheckUpdate}>
                  Check update
                </button>
              )}
            </div>
            <div className="docker-card__actions">
              <button type="button" className="btn btn--danger" disabled={c.isPending} onClick={c.onDestroy}>
                {confirmingDestroy === c.id ? 'Confirm?' : 'Destroy'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {(dialog?.mode === 'add' || dialog?.mode === 'edit') && (
        <ContainerFormDialog
          mode={dialog.mode}
          containerId={dialog.mode === 'edit' ? dialog.containerId : undefined}
          onClose={() => setDialog(null)}
          onDone={refresh}
        />
      )}

      {dialog?.mode === 'logs' && (
        <LogsDialog containerId={dialog.containerId} containerName={dialog.containerName} onClose={() => setDialog(null)} />
      )}

      {confirmingUpdate && (
        <>
          <div className="detail-overlay" onClick={() => setConfirmingUpdate(null)} />
          <div className="dialog">
            <div className="dialog__head">
              <div className="dialog__title">Update {confirmingUpdate.name}</div>
              <button type="button" className="detail-panel__close" onClick={() => setConfirmingUpdate(null)} aria-label="Close">
                &#10005;
              </button>
            </div>
            <div className="dialog__body">
              <p className="status-note" style={{ margin: '0 0 8px' }}>
                Pulls the newer image and recreates this container with its existing config unchanged. It'll be briefly
                unavailable while it restarts.
              </p>
              <div className="dialog__actions">
                <button type="button" className="btn" onClick={() => setConfirmingUpdate(null)}>
                  Cancel
                </button>
                <button type="button" className="btn btn--danger" onClick={handleConfirmUpdate}>
                  Update Now
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
