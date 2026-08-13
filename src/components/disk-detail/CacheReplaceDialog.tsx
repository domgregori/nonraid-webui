import { useCallback, useEffect, useRef, useState } from 'react';
import { cacheApi } from '../../api/cacheApi';
import { useAvailableDevices } from '../../hooks/useAvailableDevices';
import type { CacheReplaceStatus } from '../../types/cacheApi';
import { formatBytesHuman } from '../../utils/format';

interface CacheReplaceDialogProps {
  onClose: () => void;
  onDone: () => void;
}

const POLL_MS = 3000;

export function CacheReplaceDialog({ onClose, onDone }: CacheReplaceDialogProps) {
  const { devices, status: devicesStatus, error: devicesError, refresh } = useAvailableDevices();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [replaceStatus, setReplaceStatus] = useState<CacheReplaceStatus | null>(null);
  const mounted = useRef(true);

  const pollStatus = useCallback(async () => {
    try {
      const s = await cacheApi.getReplaceStatus();
      if (mounted.current) setReplaceStatus(s);
    } catch {
      // transient - next poll tries again
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!started) return;
    pollStatus();
    const id = setInterval(pollStatus, POLL_MS);
    return () => clearInterval(id);
  }, [started, pollStatus]);

  const handleReplace = async (device: string) => {
    setSubmitting(true);
    setError(null);
    try {
      await cacheApi.replaceDevice(device);
      setStarted(true);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const finished = replaceStatus && !replaceStatus.running && started;

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">Replace missing cache mirror member</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          {!started && (
            <>
              <div className="status-note status-note--error">
                Runs btrfs's own online replace against the missing mirror member - any data on the new device is
                destroyed. The cache stays usable (single-disk, no redundancy) while this runs.
              </div>

              <div className="disk-section-head">
                <div className="toggle-row__desc">Pick the replacement device.</div>
                <button type="button" className="disk-section-link disk-section-link--btn" onClick={refresh}>
                  Refresh &#8635;
                </button>
              </div>

              {devicesStatus === 'loading' && <div className="status-note">Scanning for devices…</div>}
              {devicesError && <div className="status-note status-note--error">{devicesError}</div>}
              {devicesStatus === 'ready' && devices.length === 0 && <div className="status-note">No unclaimed devices found yet.</div>}

              {devices.length > 0 && (
                <div className="unassigned-devices">
                  {devices.map((d) => (
                    <div key={d.device} className="unassigned-device-row">
                      <div>
                        <div className="unassigned-device-row__name">{d.model ?? 'Unknown drive'}</div>
                        <div className="unassigned-device-row__meta">
                          {d.sizeKb != null ? formatBytesHuman(d.sizeKb * 1024) : 'unknown size'}
                          {d.locked ? ' · locked' : ''}
                        </div>
                      </div>
                      <button type="button" className="btn btn--danger" disabled={submitting} onClick={() => handleReplace(d.device)}>
                        {submitting ? 'Starting…' : `Replace with ${d.model ?? 'this drive'}`}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {error && <div className="status-note status-note--error">{error}</div>}

              <div className="dialog__actions">
                <button type="button" className="btn" onClick={onClose}>
                  Cancel
                </button>
              </div>
            </>
          )}

          {started && (
            <>
              {!finished ? (
                <div className="status-note">
                  Replacement in progress{replaceStatus?.progressPercent != null ? ` - ${replaceStatus.progressPercent}% done` : '…'}
                </div>
              ) : (
                <div className="status-note">Replacement finished - the mirror should be healthy again.</div>
              )}
              {replaceStatus?.message && <pre className="import-raw-output">{replaceStatus.message}</pre>}
              <div className="dialog__actions">
                <button type="button" className="btn" onClick={onClose}>
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
