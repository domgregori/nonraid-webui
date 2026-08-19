import { useState } from 'react';
import { nmdApi } from '../../api/nmdApi';
import { useAvailableDevices } from '../../hooks/useAvailableDevices';
import type { AddDiskResult } from '../../types/nmdApi';
import { formatBytesHuman } from '../../utils/format';

interface ReplaceDiskDialogProps {
  slot: number;
  label: string;
  onClose: () => void;
  onDone: () => void;
}

type Step = 'confirm' | 'select' | 'result';

/**
 * Guided flow for swapping in a different physical disk. Deliberately does
 * nothing to the array until the final step, where the new device is known -
 * at that point it's one atomic backend call (nmd.replaceDisk) that unassigns,
 * commits, adds the new disk, and starts the rebuild, so the user never sees
 * a half-done state through this dialog. That's different from clicking the
 * standalone Unassign button on its own, which intentionally stops short of
 * committing (see the "restore" banner on the detail panel for that case).
 */
export function ReplaceDiskDialog({ slot, label, onClose, onDone }: ReplaceDiskDialogProps) {
  const [step, setStep] = useState<Step>('confirm');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AddDiskResult | null>(null);
  const { devices, status: devicesStatus, error: devicesError, refresh } = useAvailableDevices();

  const handleReplace = async (device: string) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await nmdApi.replaceDisk(slot, device);
      setResult(res);
      setStep('result');
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
          <div className="dialog__title">Replace {label} (slot {slot})</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          {step === 'confirm' && (
            <>
              <div className="status-note status-note--error">
                This is for swapping in a genuinely different physical disk - not for temporarily detaching this one.
                Once you pick a replacement disk on the next step, this slot's current identity is cleared and the
                array runs degraded until the new disk finishes rebuilding from parity. There's no undo past that
                point. If you just clicked here by accident, close this dialog - nothing has happened yet.
              </div>
              <div className="dialog__actions">
                <button type="button" className="btn" onClick={onClose}>
                  Cancel
                </button>
                <button type="button" className="btn--primary" onClick={() => setStep('select')}>
                  Continue
                </button>
              </div>
            </>
          )}

          {step === 'select' && (
            <>
              <div className="disk-section-head">
                <div className="toggle-row__desc">
                  Physically install the replacement disk, then pick it below. Not seeing it? It may not be connected
                  yet, or another slot still claims its identity.
                </div>
                <button type="button" className="disk-section-link disk-section-link--btn" onClick={refresh}>
                  Refresh &#8635;
                </button>
              </div>

              {devicesStatus === 'loading' && <div className="status-note">Scanning for devices…</div>}
              {devicesError && <div className="status-note status-note--error">{devicesError}</div>}
              {devicesStatus === 'ready' && devices.length === 0 && (
                <div className="status-note">No unclaimed devices found yet.</div>
              )}

              {devices.length > 0 && (
                <div className="unassigned-devices">
                  {devices.map((d) => (
                    <div key={d.device} className="unassigned-device-row">
                      <div>
                        <div className="unassigned-device-row__name">{d.model ?? 'Unknown drive'}</div>
                        <div className="unassigned-device-row__meta">
                          {d.sizeKb != null ? formatBytesHuman(d.sizeKb * 1024) : 'unknown size'}
                          {d.uuid ? ` · ${d.uuid}` : ' · no filesystem'}
                          {d.locked ? ' · locked' : ''}
                        </div>
                      </div>
                      <button type="button" className="btn btn--danger" disabled={submitting} onClick={() => handleReplace(d.device)}>
                        {submitting ? 'Replacing…' : `Replace with ${d.model ?? 'this drive'}`}
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

          {step === 'result' && result && (
            <div className="import-result">
              <div className="status-note">{result.message} Watch progress on the Parity Check card.</div>
              <pre className="import-raw-output">{result.output}</pre>
              <div className="dialog__actions">
                <button type="button" className="btn" onClick={onClose}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
