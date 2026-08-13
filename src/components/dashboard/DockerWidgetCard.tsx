import { Link } from 'react-router-dom';
import { useDockerContainers } from '../../hooks/useDockerContainers';
import { deriveContainerViewModel } from '../../selectors/containers';
import { Card } from '../shared/Card';
import { IconTile } from './IconTile';

// Read-only tile - no action buttons rendered, so these are inert.
const NOOP_ACTIONS = {
  isPending: false,
  onToggle: () => {},
  onRestart: () => {},
  onEdit: () => {},
  onViewLogs: () => {},
  onDestroy: () => {},
};

export function DockerWidgetCard() {
  const { containers } = useDockerContainers();

  return (
    <Card>
      <div className="disk-section-head">
        <div className="eyebrow disk-section-label">Docker Containers</div>
        <Link to="/docker" className="disk-section-link">
          Manage &rarr;
        </Link>
      </div>

      {containers.length === 0 ? (
        <div className="status-note">No containers yet.</div>
      ) : (
        <div className="icon-grid">
          {containers.map((c) => {
            const view = deriveContainerViewModel(c, NOOP_ACTIONS);
            return <IconTile key={c.id} name={view.name} statusLabel={view.statusLabel} statusColor={view.statusColor} iconUrl={c.icon} webUiUrl={view.webUiUrl} />;
          })}
        </div>
      )}
    </Card>
  );
}
