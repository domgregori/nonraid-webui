import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDockerContainers } from '../../hooks/useDockerContainers';
import { deriveContainerViewModel } from '../../selectors/containers';
import { Card } from '../shared/Card';
import { IconTile } from './IconTile';

// Read-only tile - no action buttons rendered, so these are inert.
const NOOP_ACTIONS = {
  isPending: false,
  updateAvailable: null,
  onToggle: () => {},
  onRestart: () => {},
  onEdit: () => {},
  onViewLogs: () => {},
  onDestroy: () => {},
  onToggleAutostart: () => {},
  onUpdateNow: () => {},
};

export function DockerWidgetCard() {
  const { t } = useTranslation('dashboard');
  const { containers } = useDockerContainers();

  return (
    <Card>
      <div className="disk-section-head">
        <div className="eyebrow disk-section-label">{t('DockerWidgetCard.dockerContainers')}</div>
        <Link to="/docker" className="disk-section-link">
          {t('DockerWidgetCard.manage')} &rarr;
        </Link>
      </div>

      {containers.length === 0 ? (
        <div className="status-note">{t('DockerWidgetCard.noContainers')}</div>
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
