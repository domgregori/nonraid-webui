import { useState } from 'react';
import { nmdApi } from '../../api/nmdApi';

interface ForceFormatDialogProps {
  slot: number;
  label: string;
  fsType: string;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Formatting normally refuses outright when a disk already carries a recognized filesystem — see
 * formatDisk()'s own two-layer backstop (this app's pre-check, then mkfs.xfs's own refusal without
 * -f). This dialog is the one deliberate way past both, for a disk that arrived with real but
 * foreign data (e.g. reused from another system) rather than anything that's part of this array.
 */
export function ForceFormatDialog({ slot, label, fsType, onClose, onDone }: ForceFormatDialogProps) {
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleConfirm = async () => {
    setRunning(true);
    setError(null);
    try {
      await nmdApi.formatDisk(slot, true);
      setDone(true);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">Force format {label} (slot {slot})</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          {done ? (
            <div className="status-note">Slot {slot} was reformatted as XFS and mounted.</div>
          ) : (
            <>
              <div className="status-note status-note--error">
                This disk has an existing {fsType} filesystem that isn't part of this array. Formatting it destroys
                everything on it, permanently, with no undo.
              </div>
              <div className="status-note status-note--error">
                Only do this if you're sure the data on this disk isn't needed — for example, a disk reused from
                another system.
              </div>
              {!confirming ? (
                <div className="dialog__actions">
                  <button type="button" className="btn" onClick={onClose}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn--danger" onClick={() => setConfirming(true)}>
                    I understand, continue
                  </button>
                </div>
              ) : (
                <>
                  {error && <div className="status-note status-note--error">{error}</div>}
                  <div className="dialog__actions">
                    <button type="button" className="btn" disabled={running} onClick={onClose}>
                      Cancel
                    </button>
                    <button type="button" className="btn btn--danger" disabled={running} onClick={handleConfirm}>
                      {running ? 'Formatting…' : 'Format Disk Anyway'}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
          {done && (
            <div className="dialog__actions">
              <button type="button" className="btn" onClick={onClose}>
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
