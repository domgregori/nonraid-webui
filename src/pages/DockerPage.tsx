import { deriveContainerViewModel } from '../selectors/containers';
import { useDockerContainers } from '../hooks/useDockerContainers';

export function DockerPage() {
  const { containers, status, error, pendingIds, start, stop, restart } = useDockerContainers();

  const views = containers.map((c) =>
    deriveContainerViewModel(c, {
      isPending: pendingIds.has(c.id),
      onToggle: () => (c.state === 'running' ? stop(c.id) : start(c.id)),
      onRestart: () => restart(c.id),
    }),
  );

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">Docker Containers</div>
        <button type="button" className="btn--primary">
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
          </div>
        ))}
      </div>
    </div>
  );
}
