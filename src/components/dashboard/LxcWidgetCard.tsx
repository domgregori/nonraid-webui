import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DistroIcon } from '../lxc/DistroIcon';
import { useLxcContainers } from '../../hooks/useLxcContainers';
import { useSettings } from '../../hooks/useSettings';
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
  const { t } = useTranslation('dashboard');
  const { containers } = useLxcContainers();
  const { settings } = useSettings();

  return (
    <Card>
      <div className="disk-section-head">
        <div className="eyebrow disk-section-label">{t('LxcWidgetCard.lxcContainers')}</div>
        <Link to="/lxc" className="disk-section-link">
          {t('LxcWidgetCard.manage')} &rarr;
        </Link>
      </div>

      {containers.length === 0 ? (
        <div className="status-note">{t('LxcWidgetCard.noContainers')}</div>
      ) : (
        <div className="icon-grid">
          {containers.map((c) => {
            const view = deriveLxcContainerViewModel(c, NOOP_ACTIONS, settings?.appLinkHost);
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
