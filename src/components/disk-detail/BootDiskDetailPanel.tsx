import { useEffect, useState } from 'react';
import { smartApi } from '../../api/smartApi';
import { systemApi } from '../../api/systemApi';
import { useSystemStats } from '../../hooks/useSystemStats';
import type { SmartAttributes } from '../../types/smart';
import { formatMemLabel } from '../../utils/format';
import { SmartOverviewRows } from './SmartOverviewRows';

interface BootDiskDetailPanelProps {
  onClose: () => void;
}

type ConfigStep = 'idle' | 'confirm';
type ImageStep = 'idle' | 'warn' | 'confirm';
type SmartLoadState = 'loading' | 'ready' | 'error';

/** No async mutation here to await, unlike the array disks' detail panel — the browser's own
 *  download manager takes over completely once the link is clicked, so this just gates that link
 *  behind a confirm step rather than tracking running/done state. */
export function BootDiskDetailPanel({ onClose }: BootDiskDetailPanelProps) {
  const stats = useSystemStats();
  const [configStep, setConfigStep] = useState<ConfigStep>('idle');
  const [imageStep, setImageStep] = useState<ImageStep>('idle');
  const [smartAttrs, setSmartAttrs] = useState<SmartAttributes | null>(null);
  const [smartLoadState, setSmartLoadState] = useState<SmartLoadState>('loading');

  const bootDevice = stats?.bootDisk?.device ?? null;

  useEffect(() => {
    if (!bootDevice) return;
    let alive = true;
    setSmartLoadState('loading');
    smartApi
      .getAttributesByDevice(bootDevice)
      .then((attrs) => {
        if (!alive) return;
        setSmartAttrs(attrs);
        setSmartLoadState('ready');
      })
      .catch(() => {
        if (alive) setSmartLoadState('error');
      });
    return () => {
      alive = false;
    };
  }, [bootDevice]);

  const boot = stats?.bootDisk;
  if (!boot) return null;

  const usedPct = boot.usedBytes !== null && boot.totalBytes !== null ? Math.round((boot.usedBytes / boot.totalBytes) * 100) : null;

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="detail-panel">
        <div className="detail-panel__head">
          <div className="detail-panel__title">Boot Disk</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <div className="detail-rows">
          <div className="detail-row">
            <span className="detail-row__label">Device</span>
            <span className="detail-row__value">{boot.device}</span>
          </div>
          <div className="detail-row">
            <span className="detail-row__label">Model</span>
            <span className="detail-row__value">{boot.model ?? '—'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-row__label">Filesystem</span>
            <span className="detail-row__value">{boot.filesystem ?? '—'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-row__label">UUID</span>
            <span className="detail-row__value">{boot.uuid ?? '—'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-row__label">Used</span>
            <span className="detail-row__value">
              {usedPct !== null && boot.usedBytes !== null && boot.totalBytes !== null
                ? `${formatMemLabel(boot.usedBytes, boot.totalBytes)} (${usedPct}%)`
                : '—'}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-row__label">Temperature</span>
            <span className="detail-row__value">{boot.tempCelsius !== null ? `${Math.round(boot.tempCelsius)}°C` : '—'}</span>
          </div>
        </div>

        <div className="smart-section">
          <div className="eyebrow">SMART</div>
          {smartLoadState === 'loading' && <div className="status-note">Loading SMART data…</div>}
          {smartLoadState === 'error' && <div className="status-note status-note--error">Failed to read SMART data for this device.</div>}
          {smartLoadState === 'ready' && !smartAttrs && <div className="status-note">No SMART data available for this disk.</div>}
          {smartAttrs && <SmartOverviewRows attributes={smartAttrs} />}
        </div>

        <div className="smart-section">
          <div className="eyebrow">Operations</div>

          <div className="status-note" style={{ marginTop: 8 }}>
            <strong>Config Backup</strong> — a small archive of Samba/NFS config, this app's own
            settings/shares/users data, and the current array superblock. Does not include the OS
            itself.
          </div>
          {configStep === 'idle' ? (
            <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => setConfigStep('confirm')}>
              Download Config Backup
            </button>
          ) : (
            <a
              className="btn btn--primary-sm"
              style={{ marginTop: 8, display: 'inline-block' }}
              href={systemApi.bootDiskConfigBackupUrl()}
              download
              onClick={() => setConfigStep('idle')}
            >
              Confirm Download
            </a>
          )}

          <div className="status-note status-note--error" style={{ marginTop: 16 }}>
            <strong>Full Disk Image</strong> — a complete byte-for-byte copy of this device
            (compressed), read live while it's mounted and in use — not a guaranteed
            filesystem-consistent snapshot. Can take a long time and produce a file up to the full
            device capacity.
          </div>
          {imageStep === 'idle' && (
            <button type="button" className="btn btn--danger" style={{ marginTop: 8 }} onClick={() => setImageStep('warn')}>
              Download Full Disk Image
            </button>
          )}
          {imageStep === 'warn' && (
            <div className="dialog__actions" style={{ marginTop: 8 }}>
              <button type="button" className="btn" onClick={() => setImageStep('idle')}>
                Cancel
              </button>
              <button type="button" className="btn btn--danger" onClick={() => setImageStep('confirm')}>
                I understand, continue
              </button>
            </div>
          )}
          {imageStep === 'confirm' && (
            <a
              className="btn btn--danger"
              style={{ marginTop: 8, display: 'inline-block' }}
              href={systemApi.bootDiskImageBackupUrl()}
              download
              onClick={() => setImageStep('idle')}
            >
              Confirm Download
            </a>
          )}
        </div>
      </div>
    </>
  );
}
