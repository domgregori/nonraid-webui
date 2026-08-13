import { Link } from 'react-router-dom';
import { useLxcContainers } from '../../hooks/useLxcContainers';
import { deriveLxcContainerViewModel } from '../../selectors/lxcContainers';
import { Card } from '../shared/Card';
import { IconTile } from './IconTile';

// Read-only tile - no action buttons rendered, so these are inert.
const NOOP_ACTIONS = { isPending: false, onToggle: () => {}, onRestart: () => {}, onDestroy: () => {}, onEdit: () => {}, onSnapshots: () => {} };

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
            // LXC containers have no icon convention (they're OS templates, not app images) - always falls back to the initial-letter avatar.
            return <IconTile key={c.name} name={view.name} statusLabel={view.statusLabel} statusColor={view.statusColor} webUiUrl={view.webUiUrl} />;
          })}
        </div>
      )}
    </Card>
  );
}
