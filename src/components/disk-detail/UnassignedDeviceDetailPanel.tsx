import { useEffect, useState } from 'react';
import { nmdApi } from '../../api/nmdApi';
import { smartApi } from '../../api/smartApi';
import type { AvailableDevice } from '../../types/nmdApi';
import type { SmartAttributes } from '../../types/smart';
import { formatBytesHuman } from '../../utils/format';
import { BenchmarkSection } from './BenchmarkSection';
import { SmartOverviewRows } from './SmartOverviewRows';

interface UnassignedDeviceDetailPanelProps {
  device: AvailableDevice;
  onClose: () => void;
  onAddToArray: () => void;
}

type SmartLoadState = 'loading' | 'ready' | 'error';

/** Same info shape as the array-disk detail panel (DiskDetailPanel.tsx) - an unassigned device has
 *  no array slot, so this fetches SMART by raw device path instead, same route the boot disk panel
 *  uses. */
export function UnassignedDeviceDetailPanel({ device, onClose, onAddToArray }: UnassignedDeviceDetailPanelProps) {
  const [attrs, setAttrs] = useState<SmartAttributes | null>(null);
  const [loadState, setLoadState] = useState<SmartLoadState>('loading');

  useEffect(() => {
    let alive = true;
    setLoadState('loading');
    smartApi
      .getAttributesByDevice(device.device)
      .then((a) => {
        if (!alive) return;
        setAttrs(a);
        setLoadState('ready');
      })
      .catch(() => {
        if (alive) setLoadState('error');
      });
    return () => {
      alive = false;
    };
  }, [device.device]);

  const typeLabel = device.isSSD === true ? 'SSD' : device.isSSD === false ? 'HDD' : undefined;

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="detail-panel">
        <div className="detail-panel__head">
          <div className="detail-panel__title">{device.model ?? 'Unassigned Device'}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <div className="detail-panel__body">
          <div className="detail-card">
            <div className="eyebrow">Info</div>
            <div className="detail-rows">
              <div className="detail-row">
                <span className="detail-row__label">Device</span>
                <span className="detail-row__value">{device.device}</span>
              </div>
              <div className="detail-row">
                <span className="detail-row__label">Size</span>
                <span className="detail-row__value">{device.sizeKb != null ? formatBytesHuman(device.sizeKb * 1024) : '-'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-row__label">Filesystem UUID</span>
                <span className="detail-row__value">{device.uuid ?? 'none (unformatted)'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-row__label">Serial</span>
                <span className="detail-row__value">{device.diskId ?? '-'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-row__label">Locked</span>
                <span className="detail-row__value">{device.locked ? 'Yes - likely in use elsewhere' : 'No'}</span>
              </div>
            </div>
          </div>

          <div className="detail-card">
            <div className="eyebrow">SMART</div>
            {loadState === 'loading' && <div className="status-note">Loading SMART data…</div>}
            {loadState === 'error' && <div className="status-note status-note--error">Failed to read SMART data for this device.</div>}
            {loadState === 'ready' && !attrs && <div className="status-note">No SMART data available for this disk.</div>}
            {attrs && <SmartOverviewRows attributes={attrs} typeLabel={typeLabel} />}
          </div>

          <BenchmarkSection onRead={(durationSeconds) => nmdApi.benchmarkReadDevice(device.device, durationSeconds)} />
        </div>

        <div className="detail-actions">
          <button type="button" className="btn btn--block" onClick={onAddToArray} disabled={device.locked}>
            Add to Array
          </button>
        </div>
      </div>
    </>
  );
}
