import { useState } from 'react';
import { cacheApi } from '../../api/cacheApi';
import { useAvailableDevices } from '../../hooks/useAvailableDevices';
import { formatBytesHuman } from '../../utils/format';

interface CacheSetupDialogProps {
  onClose: () => void;
  onDone: () => void;
}

/**
 * Picks two devices for the mirror from the same pool AddDiskDialog draws from — refusing to let
 * both picks be the same device is the only extra rule beyond what a single-device picker needs,
 * since cache setup runs mkfs.btrfs across exactly two devices, never one.
 */
export function CacheSetupDialog({ onClose, onDone }: CacheSetupDialogProps) {
  const { devices, status: devicesStatus, error: devicesError, refresh } = useAvailableDevices();
  const [deviceA, setDeviceA] = useState('');
  const [deviceB, setDeviceB] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const selectedA = devices.find((d) => d.device === deviceA);
  const selectedB = devices.find((d) => d.device === deviceB);
  const sameDevice = !!deviceA && deviceA === deviceB;
  const canSubmit = !!deviceA && !!deviceB && !sameDevice && !submitting;

  const handleSetup = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await cacheApi.setup(deviceA, deviceB);
      setResult(res.message);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">Set up cache mirror</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          {!result && (
            <>
              <div className="status-note status-note--error">
                This formats both devices as a single btrfs RAID1 filesystem — any existing data on either device is
                destroyed. Only devices with no recognized filesystem or mounted partition are offered below.
              </div>

              <div className="disk-section-head">
                <div className="toggle-row__desc">Pick two different devices for the mirrored pair.</div>
                <button type="button" className="disk-section-link disk-section-link--btn" onClick={refresh}>
                  Refresh &#8635;
                </button>
              </div>

              {devicesStatus === 'loading' && <div className="status-note">Scanning for devices…</div>}
              {devicesError && <div className="status-note status-note--error">{devicesError}</div>}
              {devicesStatus === 'ready' && devices.length < 2 && (
                <div className="status-note">
                  {devices.length === 0 ? 'No unassigned devices found.' : 'Only one unassigned device found — a mirror needs two.'}
                </div>
              )}

              {devices.length > 0 && (
                <div className="settings-field">
                  <div className="toggle-row__title">First device</div>
                  <select className="history-input" style={{ width: '100%' }} value={deviceA} onChange={(e) => setDeviceA(e.target.value)}>
                    <option value="">Select a device…</option>
                    {devices.map((d) => (
                      <option key={d.device} value={d.device}>
                        {d.model ?? d.device} · {d.sizeKb != null ? formatBytesHuman(d.sizeKb * 1024) : 'unknown size'}
                      </option>
                    ))}
                  </select>
                  {selectedA?.locked && (
                    <div className="status-note status-note--error">This device appears to be locked/in use — setup may fail.</div>
                  )}

                  <div className="toggle-row__title" style={{ marginTop: 10 }}>
                    Second device
                  </div>
                  <select className="history-input" style={{ width: '100%' }} value={deviceB} onChange={(e) => setDeviceB(e.target.value)}>
                    <option value="">Select a device…</option>
                    {devices.map((d) => (
                      <option key={d.device} value={d.device}>
                        {d.model ?? d.device} · {d.sizeKb != null ? formatBytesHuman(d.sizeKb * 1024) : 'unknown size'}
                      </option>
                    ))}
                  </select>
                  {selectedB?.locked && (
                    <div className="status-note status-note--error">This device appears to be locked/in use — setup may fail.</div>
                  )}
                  {sameDevice && <div className="status-note status-note--error">Pick two different devices.</div>}
                </div>
              )}

              {error && <div className="status-note status-note--error">{error}</div>}
            </>
          )}

          {result && <div className="status-note">{result}</div>}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onClose}>
              {result ? 'Close' : 'Cancel'}
            </button>
            {!result && (
              <button type="button" className="btn--primary" disabled={!canSubmit} onClick={handleSetup}>
                {submitting ? 'Setting up…' : 'Set Up Mirror'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
