import { useEffect, useState } from 'react';
import { smartApi } from '../../api/smartApi';
import { useAvailableDevices } from '../../hooks/useAvailableDevices';
import { COLORS } from '../../styles/colors';
import type { AvailableDevice } from '../../types/nmdApi';
import { formatBytesHuman } from '../../utils/format';
import { Card } from '../shared/Card';
import { AddDiskDialog } from './AddDiskDialog';

/** Fetched per row on mount — unassigned devices have no array-wide poll to piggyback on, and
 *  there are normally only a handful of them, so one on-demand call each is cheap enough. */
function HealthDot({ device }: { device: string }) {
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

  const color = health === 'failed' ? COLORS.red : health === 'passed' ? COLORS.green : COLORS.textDim;
  return <span className="disk-card__health-dot" style={{ background: color, display: 'inline-block' }} title={`SMART: ${health ?? 'unknown'}`} />;
}

export function UnassignedDevicesCard() {
  const { devices, status, error, refresh } = useAvailableDevices();
  const [selected, setSelected] = useState<AvailableDevice | null>(null);

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
            <div key={d.device} className="unassigned-device-row">
              <div>
                <div className="unassigned-device-row__name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <HealthDot device={d.device} />
                  {d.model ?? 'Unknown drive'}
                </div>
                <div className="unassigned-device-row__meta">
                  {d.sizeKb != null ? formatBytesHuman(d.sizeKb * 1024) : 'unknown size'}
                  {d.isSSD !== null ? ` · ${d.isSSD ? 'SSD' : 'HDD'}` : ''}
                  {d.diskId ? ` · ${d.diskId}` : ''}
                  {d.uuid ? ` · ${d.uuid}` : ' · no filesystem'}
                  {d.locked ? ' · locked' : ''}
                </div>
              </div>
              <button type="button" className="btn" onClick={() => setSelected(d)}>
                Add to Array
              </button>
            </div>
          ))}
        </div>
      )}

      {selected && <AddDiskDialog device={selected} onClose={() => setSelected(null)} onDone={refresh} />}
    </Card>
  );
}
