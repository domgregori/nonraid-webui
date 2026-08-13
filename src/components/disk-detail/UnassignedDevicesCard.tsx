import { useEffect, useState } from 'react';
import { smartApi } from '../../api/smartApi';
import { useAvailableDevices } from '../../hooks/useAvailableDevices';
import { COLORS } from '../../styles/colors';
import type { AvailableDevice } from '../../types/nmdApi';
import { formatBytesHuman } from '../../utils/format';
import { Card } from '../shared/Card';
import { AddDiskDialog } from './AddDiskDialog';
import { UnassignedDeviceDetailPanel } from './UnassignedDeviceDetailPanel';

/** Fetched per row on mount - unassigned devices have no array-wide poll to piggyback on, and
 *  there are normally only a handful of them, so one on-demand call each is cheap enough. Drives
 *  the row's top-border color (see the .disk-card__health-dot doc comment history - a dot read as
 *  too easy to miss, so health is now a border color instead). */
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
  const health = useDeviceHealth(d.device);
  const healthColor = health === 'failed' ? COLORS.red : health === 'passed' ? COLORS.green : COLORS.border;

  return (
    <div className="unassigned-device-row" style={{ borderTopColor: healthColor }} onClick={onOpen} title={`SMART: ${health ?? 'unknown'}`}>
      <div className="unassigned-device-row__info">
        <div className="unassigned-device-row__name">{d.model ?? 'Unknown drive'}</div>
        <div className="unassigned-device-row__meta">
          {d.sizeKb != null ? formatBytesHuman(d.sizeKb * 1024) : 'unknown size'}
          {d.isSSD !== null ? ` · ${d.isSSD ? 'SSD' : 'HDD'}` : ''}
          {d.diskId ? ` · ${d.diskId}` : ''}
          {d.uuid ? ` · ${d.uuid}` : ' · no filesystem'}
          {d.locked ? ' · locked' : ''}
        </div>
      </div>
      <button
        type="button"
        className="btn btn--primary-sm"
        onClick={(e) => {
          e.stopPropagation();
          onAdd();
        }}
        title="Assigns this disk to a slot in the array and starts rebuilding its data from parity."
      >
        Add to Array
      </button>
    </div>
  );
}

export function UnassignedDevicesCard() {
  const { devices, status, error, refresh } = useAvailableDevices();
  const [selected, setSelected] = useState<AvailableDevice | null>(null);
  const [inspecting, setInspecting] = useState<AvailableDevice | null>(null);

  return (
    <Card>
      <div className="disk-section-head">
        <div className="eyebrow disk-section-label">Unassigned Devices</div>
        <button type="button" className="disk-section-link disk-section-link--btn" onClick={refresh}>
          Refresh &#8635;
        </button>
      </div>

      {status === 'loading' && <div className="status-note">Scanning for devices…</div>}
      {error && <div className="status-note status-note--error">{error}</div>}
      {status === 'ready' && devices.length === 0 && <div className="status-note">No unassigned devices found.</div>}

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
