import { useState } from 'react';
import { diskQueueApi } from '../../api/diskQueueApi';
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
// slot 0 is always Parity 1, slot 29 is always Parity 2, 1-28 are data. The actual slot number is
// now resolved server-side (see routes/diskQueue.ts) the same way this dialog used to pick it
// itself - kept here only for the parityTaken/parity2Taken option-disabling checks below.
const PARITY_SLOT = 0;
const PARITY2_SLOT = 29;

export function AddDiskDialog({ device, onClose, onDone }: AddDiskDialogProps) {
  const { status } = useArrayStatus();
  // nmdctl always reports a placeholder slot-0 (parity) row with an empty disk_id even on a
  // totally blank array (see OnboardingWizard's disk summary, which filters the same way) - only
  // a real disk_id means the slot is actually occupied.
  const usedSlots = new Set((status?.disks ?? []).filter((d) => d.disk_id).map((d) => d.slot));
  const parityTaken = usedSlots.has(PARITY_SLOT);
  const parity2Taken = usedSlots.has(PARITY2_SLOT);

  const [role, setRole] = useState<Role>('data');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roleAlreadyTaken = (role === 'parity' && parityTaken) || (role === 'parity2' && parity2Taken);
  const arrayStarted = status?.array.state === 'STARTED';

  const handleAdd = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // parity1/parity2 both map to the same enqueueParity call - the backend resolves slot 0
      // vs 29 the same way this dialog used to (see routes/diskQueue.ts).
      const item = role === 'data' ? await diskQueueApi.enqueueData(device.device) : await diskQueueApi.enqueueParity(device.device);
      setResult(
        item.status === 'running'
          ? 'Added to the queue - starting now.'
          : 'Added to the queue - will start once the current operation finishes.',
      );
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
              <span className="detail-row__value">{device.sizeKb != null ? formatBytesHuman(device.sizeKb * 1024) : '-'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-row__label">UUID</span>
              <span className="detail-row__value">{device.uuid ?? '(no filesystem)'}</span>
            </div>
          </div>

          {device.locked && (
            <div className="status-note status-note--error">
              This device appears to be locked/in use by another process - adding it may fail.
            </div>
          )}
          {!device.partition && <div className="status-note">No partition detected - it'll be assigned and cleared as a raw disk.</div>}
          {arrayStarted && (
            <div className="status-note">The array is currently running - it'll be stopped automatically when this item's turn comes up.</div>
          )}

          {!result && (
            <div className="settings-field">
              <div className="toggle-row__title">Assign as</div>
              <div className="toggle-row__desc">
                Parity has to be at least as large as your biggest data disk. A second parity disk is optional - it
                protects against two disk failures at once instead of one.
              </div>
              <select className="history-input" value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={submitting}>
                <option value="data">Data disk</option>
                <option value="parity" disabled={parityTaken}>
                  Parity 1{parityTaken ? ' (already assigned)' : ''}
                </option>
                <option value="parity2" disabled={parity2Taken}>
                  Parity 2{parity2Taken ? ' (already assigned)' : ''}
                </option>
              </select>
              {role === 'data' && (
                <div className="toggle-row__desc" style={{ marginTop: 10 }}>
                  The first free data slot (1-28) is used automatically.
                </div>
              )}

              {roleAlreadyTaken && <div className="status-note status-note--error">That slot already has a disk assigned.</div>}
            </div>
          )}

          {error && <div className="status-note status-note--error">{error}</div>}

          {result && (
            <div className="status-note">
              {result} Watch progress on the Disk Queue card.
            </div>
          )}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onClose}>
              {result ? 'Close' : 'Cancel'}
            </button>
            {!result && (
              <button type="button" className="btn--primary" disabled={submitting || roleAlreadyTaken} onClick={handleAdd}>
                {submitting ? 'Adding…' : 'Add Disk'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
