import { CONTAINERS } from '../mock/containers';
import { deriveContainerViewModel } from '../selectors/containers';
import { useAppStore } from '../state/useAppStore';

export function DockerPage() {
  const { state, dispatch } = useAppStore();
  const containers = CONTAINERS.map((c) =>
    deriveContainerViewModel(c, state.containers[c.name], () => dispatch({ type: 'TOGGLE_CONTAINER', name: c.name })),
  );

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">Docker Containers</div>
        <button type="button" className="btn--primary">
          Add Container
        </button>
      </div>

      <div className="docker-grid">
        {containers.map((c) => (
          <div className="docker-card" key={c.name}>
            <div className="docker-card__head">
              <div className="docker-card__name">{c.name}</div>
              <span className="docker-card__status" style={{ color: c.statusColor }}>
                <span className="docker-card__status-dot" style={{ background: c.statusColor }} />
                {c.statusLabel}
              </span>
            </div>
            <div className="docker-card__image">{c.image}</div>
            <div className="docker-card__stats">
              <span>CPU {c.cpu}</span>
              <span>Mem {c.mem}</span>
              <span>{c.ports}</span>
            </div>
            <div className="docker-card__actions">
              <button
                type="button"
                className="btn"
                style={{ borderColor: c.toggleBorder, background: c.toggleBg, color: c.toggleFg }}
                onClick={c.onToggle}
              >
                {c.toggleLabel}
              </button>
              <button type="button" className="btn">
                Restart
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
