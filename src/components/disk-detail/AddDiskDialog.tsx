import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('diskDetail');
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
          ? t('AddDiskDialog.addedRunning')
          : t('AddDiskDialog.addedQueued'),
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
          <div className="dialog__title">{t('AddDiskDialog.title', { model: device.model ?? t('AddDiskDialog.driveFallback') })}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('AddDiskDialog.close')}>
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          <div className="detail-rows">
            <div className="detail-row">
              <span className="detail-row__label">{t('AddDiskDialog.drive')}</span>
              <span className="detail-row__value">{device.model ?? t('AddDiskDialog.unknownDrive')}</span>
            </div>
            <div className="detail-row">
              <span className="detail-row__label">{t('AddDiskDialog.size')}</span>
              <span className="detail-row__value">{device.sizeKb != null ? formatBytesHuman(device.sizeKb * 1024) : '-'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-row__label">{t('AddDiskDialog.uuid')}</span>
              <span className="detail-row__value">{device.uuid ?? t('AddDiskDialog.noFilesystem')}</span>
            </div>
          </div>

          {device.locked && (
            <div className="status-note status-note--error">
              {t('AddDiskDialog.lockedWarning')}
            </div>
          )}
          {!device.partition && <div className="status-note">{t('AddDiskDialog.noPartitionWarning')}</div>}
          {arrayStarted && (
            <div className="status-note">{t('AddDiskDialog.arrayRunningWarning')}</div>
          )}

          {!result && (
            <div className="settings-field">
              <div className="toggle-row__title">{t('AddDiskDialog.assignAs')}</div>
              <div className="toggle-row__desc">
                {t('AddDiskDialog.assignDesc')}
              </div>
              <select className="history-input" value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={submitting}>
                <option value="data">{t('AddDiskDialog.dataDisk')}</option>
                <option value="parity" disabled={parityTaken}>
                  {t('AddDiskDialog.parity1')}{parityTaken ? t('AddDiskDialog.alreadyAssigned') : ''}
                </option>
                <option value="parity2" disabled={parity2Taken}>
                  {t('AddDiskDialog.parity2')}{parity2Taken ? t('AddDiskDialog.alreadyAssigned') : ''}
                </option>
              </select>
              {role === 'data' && (
                <div className="toggle-row__desc" style={{ marginTop: 10 }}>
                  {t('AddDiskDialog.dataSlotNote')}
                </div>
              )}

              {roleAlreadyTaken && <div className="status-note status-note--error">{t('AddDiskDialog.slotTaken')}</div>}
            </div>
          )}

          {error && <div className="status-note status-note--error">{error}</div>}

          {result && (
            <div className="status-note">
              {result} {t('AddDiskDialog.watchProgress')}
            </div>
          )}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onClose}>
              {result ? t('AddDiskDialog.close') : t('AddDiskDialog.cancel')}
            </button>
            {!result && (
              <button type="button" className="btn--primary" disabled={submitting || roleAlreadyTaken} onClick={handleAdd}>
                {submitting ? t('AddDiskDialog.adding') : t('AddDiskDialog.addDisk')}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
