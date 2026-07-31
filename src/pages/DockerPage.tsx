import { useState } from 'react';
import { ContainerFormDialog } from '../components/docker/ContainerFormDialog';
import { useDockerContainers } from '../hooks/useDockerContainers';
import { deriveContainerViewModel } from '../selectors/containers';

type DialogState = { mode: 'add' } | { mode: 'edit'; containerId: string } | null;

export function DockerPage() {
  const { containers, status, error, pendingIds, start, stop, restart, refresh } = useDockerContainers();
  const [dialog, setDialog] = useState<DialogState>(null);

  const views = containers.map((c) =>
    deriveContainerViewModel(c, {
      isPending: pendingIds.has(c.id),
      onToggle: () => (c.state === 'running' ? stop(c.id) : start(c.id)),
      onRestart: () => restart(c.id),
      onEdit: () => setDialog({ mode: 'edit', containerId: c.id }),
    }),
  );

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">Docker Containers</div>
        <button type="button" className="btn--primary" onClick={() => setDialog({ mode: 'add' })}>
          Add Container
        </button>
      </div>

      {status === 'loading' && <div className="status-note">Loading containers…</div>}
      {error && <div className="status-note status-note--error">{error}</div>}

      <div className="docker-grid">
        {views.map((c) => (
          <div className="docker-card" key={c.id}>
            <div className="docker-card__head">
              <div className="docker-card__name">{c.name}</div>
              <span className="docker-card__status" style={{ color: c.statusColor }}>
                <span className="docker-card__status-dot" style={{ background: c.statusColor }} />
                {c.statusLabel}
              </span>
            </div>
            <div className="docker-card__image">{c.image}</div>
            <div className="docker-card__badges">
              {c.caAppName ? (
                <span className="docker-card__badge docker-card__badge--ca">CA: {c.caAppName}</span>
              ) : (
                <span className="docker-card__badge docker-card__badge--custom">Custom</span>
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
              <button type="button" className="btn" disabled={c.isPending} onClick={c.onEdit}>
                Edit
              </button>
            </div>
          </div>
        ))}
      </div>

      {dialog && (
        <ContainerFormDialog
          mode={dialog.mode}
          containerId={dialog.mode === 'edit' ? dialog.containerId : undefined}
          onClose={() => setDialog(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
}
