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

type Role = 'parity' | 'parity2' | 'data';

// nmdctl's own slot numbering (see backend/src/nmd/superblock.ts's MD_SB_P_IDX/MD_SB_Q_IDX):
// slot 0 is always Parity 1, slot 29 is always Parity 2, 1-28 are data.
const PARITY_SLOT = 0;
const PARITY2_SLOT = 29;

export function AddDiskDialog({ device, onClose, onDone }: AddDiskDialogProps) {
  const { status } = useArrayStatus();
  // nmdctl always reports a placeholder slot-0 (parity) row with an empty disk_id even on a
  // totally blank array (see OnboardingWizard's disk summary, which filters the same way) — only
  // a real disk_id means the slot is actually occupied.
  const usedSlots = new Set((status?.disks ?? []).filter((d) => d.disk_id).map((d) => d.slot));
  const defaultDataSlot = Array.from({ length: 28 }, (_, i) => i + 1).find((s) => !usedSlots.has(s)) ?? 1;
  const parityTaken = usedSlots.has(PARITY_SLOT);
  const parity2Taken = usedSlots.has(PARITY2_SLOT);

  const [role, setRole] = useState<Role>('data');
  const [dataSlot, setDataSlot] = useState(defaultDataSlot);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ message: string; output: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const slot = role === 'parity' ? PARITY_SLOT : role === 'parity2' ? PARITY2_SLOT : dataSlot;
  const roleAlreadyTaken = (role === 'parity' && parityTaken) || (role === 'parity2' && parity2Taken);
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
              <div className="toggle-row__title">Assign as</div>
              <div className="toggle-row__desc">
                Parity has to be at least as large as your biggest data disk. A second parity disk is optional — it
                protects against two disk failures at once instead of one.
              </div>
              <select
                className="history-input"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                disabled={submitting || arrayStarted}
              >
                <option value="data">Data disk</option>
                <option value="parity" disabled={parityTaken}>
                  Parity 1{parityTaken ? ' (already assigned)' : ''}
                </option>
                <option value="parity2" disabled={parity2Taken}>
                  Parity 2{parity2Taken ? ' (already assigned)' : ''}
                </option>
              </select>

              {role === 'data' && (
                <>
                  <div className="toggle-row__title" style={{ marginTop: 10 }}>
                    Data slot
                  </div>
                  <div className="toggle-row__desc">A slot that already has a disk assigned isn't valid here — use Replace Disk for those.</div>
                  <input
                    className="history-input"
                    type="number"
                    min={1}
                    max={28}
                    value={dataSlot}
                    onChange={(e) => setDataSlot(Number(e.target.value))}
                    disabled={submitting || arrayStarted}
                  />
                </>
              )}

              {roleAlreadyTaken && <div className="status-note status-note--error">That slot already has a disk assigned.</div>}
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
              <button type="button" className="btn--primary" disabled={submitting || arrayStarted || roleAlreadyTaken} onClick={handleAdd}>
                {submitting ? 'Adding…' : 'Add Disk'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
