import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { smartApi } from '../../api/smartApi';
import { useAvailableDevices } from '../../hooks/useAvailableDevices';
import { COLORS } from '../../styles/colors';
import type { AvailableDevice } from '../../types/nmdApi';
import { formatBytesHuman } from '../../utils/format';
import { Card } from '../shared/Card';
import { AddDiskDialog } from './AddDiskDialog';
import { UnassignedDeviceDetailPanel } from './UnassignedDeviceDetailPanel';

/** Fetched per row on mount - unassigned devices have no array-wide poll to piggyback on, and
 *  there are normally only a handful of them, so one on-demand call each is cheap enough. Shown as
 *  its own dot+label row, same treatment as DiskCard's .disk-card__health - a colored top border
 *  read as one ambiguous signal instead of an explicit one. */
function useDeviceHealth(device: string): 'passed' | 'failed' | null {
  const [health, setHealth] = useState<'passed' | 'failed' | null>(null);

  useEffect(() => {
    let alive = true;
    smartApi
      .getAttributesByDevice(device)
      .then((attrs) => {
        if (alive) setHealth(attrs?.health ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [device]);

  return health;
}

function DeviceRow({ device: d, onOpen, onAdd }: { device: AvailableDevice; onOpen: () => void; onAdd: () => void }) {
  const { t } = useTranslation('diskDetail');
  const health = useDeviceHealth(d.device);
  const healthColor = health === 'failed' ? COLORS.red : health === 'passed' ? COLORS.green : COLORS.textDim;
  const healthLabel = health === 'failed' ? t('UnassignedDevicesCard.smartFailing') : health === 'passed' ? t('UnassignedDevicesCard.smartOk') : t('UnassignedDevicesCard.smartUnknown');

  return (
    <div className="unassigned-device-row" onClick={onOpen}>
      <div className="unassigned-device-row__info">
        <div className="unassigned-device-row__name">{d.model ?? t('UnassignedDevicesCard.unknownDrive')}</div>
        <div className="unassigned-device-row__meta">
          {d.sizeKb != null ? formatBytesHuman(d.sizeKb * 1024) : t('UnassignedDevicesCard.unknownSize')}
          {d.isSSD !== null ? ` · ${d.isSSD ? 'SSD' : 'HDD'}` : ''}
          {d.diskId ? ` · ${d.diskId}` : ''}
          {d.uuid ? ` · ${d.uuid}` : ` · ${t('UnassignedDevicesCard.noFilesystem')}`}
          {d.locked ? ` · ${t('UnassignedDevicesCard.locked')}` : ''}
        </div>
        <span className="disk-card__health" style={{ color: healthColor }}>
          <span className="disk-card__health-dot" style={{ background: healthColor }} />
          {healthLabel}
        </span>
      </div>
      <button
        type="button"
        className="btn btn--primary-sm"
        onClick={(e) => {
          e.stopPropagation();
          onAdd();
        }}
        title={t('UnassignedDevicesCard.addToArrayTitle')}
      >
        {t('UnassignedDevicesCard.addToArray')}
      </button>
    </div>
  );
}

export function UnassignedDevicesCard() {
  const { t } = useTranslation('diskDetail');
  const { devices, status, error, refresh } = useAvailableDevices();
  const [selected, setSelected] = useState<AvailableDevice | null>(null);
  const [inspecting, setInspecting] = useState<AvailableDevice | null>(null);

  return (
    <Card>
      <div className="disk-section-head">
        <div className="eyebrow disk-section-label">{t('UnassignedDevicesCard.title')}</div>
        <button type="button" className="disk-section-link disk-section-link--btn" onClick={refresh}>
          {t('UnassignedDevicesCard.refresh')} &#8635;
        </button>
      </div>

      {status === 'loading' && <div className="status-note">{t('UnassignedDevicesCard.scanning')}</div>}
      {error && <div className="status-note status-note--error">{error}</div>}
      {status === 'ready' && devices.length === 0 && <div className="status-note">{t('UnassignedDevicesCard.noDevices')}</div>}

      {devices.length > 0 && (
        <div className="unassigned-devices">
          {devices.map((d) => (
            <DeviceRow key={d.device} device={d} onOpen={() => setInspecting(d)} onAdd={() => setSelected(d)} />
          ))}
        </div>
      )}

      {selected && <AddDiskDialog device={selected} onClose={() => setSelected(null)} onDone={refresh} />}
      {inspecting && (
        <UnassignedDeviceDetailPanel
          device={inspecting}
          onClose={() => setInspecting(null)}
          onAddToArray={() => {
            setSelected(inspecting);
            setInspecting(null);
          }}
        />
      )}
    </Card>
  );
}
