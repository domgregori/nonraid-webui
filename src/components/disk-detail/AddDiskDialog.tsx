import { useState } from 'react';
import { nmdApi } from '../../api/nmdApi';
import { useArrayStatus } from '../../state/useArrayStatus';
import type { AvailableDevice } from '../../types/nmdApi';
import { formatBytesHuman } from '../../utils/format';

interface AddDiskDialogProps {
  device: AvailableDevice;
  onClose: () => void;
  onDone: () => void;
}

export function AddDiskDialog({ device, onClose, onDone }: AddDiskDialogProps) {
  const { status } = useArrayStatus();
  const usedSlots = new Set((status?.disks ?? []).map((d) => d.slot));
  const defaultSlot = Array.from({ length: 28 }, (_, i) => i + 1).find((s) => !usedSlots.has(s)) ?? 1;

  const [slot, setSlot] = useState(defaultSlot);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ message: string; output: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const arrayStarted = status?.array.state === 'STARTED';

  const handleAdd = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await nmdApi.addDisk(slot, device.device);
      setResult(res);
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
          <div className="dialog__title">Add {device.model ?? 'drive'} to array</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          <div className="detail-rows">
            <div className="detail-row">
              <span className="detail-row__label">Drive</span>
              <span className="detail-row__value">{device.model ?? 'Unknown drive'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-row__label">Size</span>
              <span className="detail-row__value">{device.sizeKb != null ? formatBytesHuman(device.sizeKb * 1024) : '—'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-row__label">UUID</span>
              <span className="detail-row__value">{device.uuid ?? '(no filesystem)'}</span>
            </div>
          </div>

          {device.locked && (
            <div className="status-note status-note--error">
              This device appears to be locked/in use by another process — adding it may fail.
            </div>
          )}
          {!device.partition && <div className="status-note">No partition detected — it'll be assigned and cleared as a raw disk.</div>}
          {arrayStarted && <div className="status-note status-note--error">Stop the array before adding a disk.</div>}

          {!result && (
            <div className="settings-field">
              <div className="toggle-row__title">Target slot</div>
              <div className="toggle-row__desc">
                Any empty data slot (1-28) works. A slot that already has a disk assigned isn't valid here — use Replace
                Disk for those.
              </div>
              <input
                className="history-input"
                type="number"
                min={1}
                max={28}
                value={slot}
                onChange={(e) => setSlot(Number(e.target.value))}
                disabled={submitting || arrayStarted}
              />
            </div>
          )}

          {error && <div className="status-note status-note--error">{error}</div>}

          {result && (
            <div className="import-result">
              <div className="status-note">{result.message} Watch progress on the Parity Check card.</div>
              <pre className="import-raw-output">{result.output}</pre>
            </div>
          )}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onClose}>
              {result ? 'Close' : 'Cancel'}
            </button>
            {!result && (
              <button type="button" className="btn--primary" disabled={submitting || arrayStarted} onClick={handleAdd}>
                {submitting ? 'Adding…' : 'Add Disk'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
