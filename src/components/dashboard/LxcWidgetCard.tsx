import { Link } from 'react-router-dom';
import { DistroIcon } from '../lxc/DistroIcon';
import { useLxcContainers } from '../../hooks/useLxcContainers';
import { deriveLxcContainerViewModel } from '../../selectors/lxcContainers';
import { Card } from '../shared/Card';
import { IconTile } from './IconTile';

// Read-only tile - no action buttons rendered, so these are inert.
const NOOP_ACTIONS = {
  isPending: false,
  onToggle: () => {},
  onRestart: () => {},
  onDestroy: () => {},
  onEdit: () => {},
  onSnapshots: () => {},
  onToggleAutostart: () => {},
};

export function LxcWidgetCard() {
  const { containers } = useLxcContainers();

  return (
    <Card>
      <div className="disk-section-head">
        <div className="eyebrow disk-section-label">LXC Containers</div>
        <Link to="/lxc" className="disk-section-link">
          Manage &rarr;
        </Link>
      </div>

      {containers.length === 0 ? (
        <div className="status-note">No LXC containers yet.</div>
      ) : (
        <div className="icon-grid">
          {containers.map((c) => {
            const view = deriveLxcContainerViewModel(c, NOOP_ACTIONS);
            return (
              <IconTile
                key={c.name}
                name={view.name}
                statusLabel={view.statusLabel}
                statusColor={view.statusColor}
                webUiUrl={view.webUiUrl}
                icon={<DistroIcon distribution={view.distribution} fallbackLabel={view.name} size={32} />}
              />
            );
          })}
        </div>
      )}
    </Card>
  );
}
