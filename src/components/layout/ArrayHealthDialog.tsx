import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UnlockAllDialog } from '../disk-detail/UnlockAllDialog';
import { useSettings } from '../../hooks/useSettings';
import { deriveDisks } from '../../selectors/disks';
import { deriveDegradedReasons, isDegraded } from '../../selectors/status';
import { useArrayStatus } from '../../state/useArrayStatus';

interface ArrayHealthDialogProps {
  onClose: () => void;
}

/** Opened from the header's DEGRADED pill (see ArrayStatusPill) - explains each reason
 *  deriveDegradedReasons found and, where there's a safe one-click fix, offers a button for it. */
export function ArrayHealthDialog({ onClose }: ArrayHealthDialogProps) {
  const { t } = useTranslation('layout');
  const { status, temps, parityPending, parityAction, selectDisk, refresh } = useArrayStatus();
  const { settings } = useSettings();
  const [showUnlockAll, setShowUnlockAll] = useState(false);
  if (!status) return null;

  const goToDisk = (diskId: string) => {
    selectDisk(diskId);
    onClose();
  };

  const reasons = deriveDegradedReasons(status);
  // Same diskLabels thread the Disks page's own Unlock All entry point uses, so a locked disk's
  // custom nickname shows up here too - see selectors/disks.ts's deriveDisks().
  const lockedDisks = deriveDisks(status, temps, {}, {}, {}, {}, settings?.diskLabels ?? {}).data.filter((d) => d.encryption === 'luks-locked');

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{t('ArrayHealthDialog.title')}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('ArrayHealthDialog.close')}>
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          {!isDegraded(status) ? (
            <div className="status-note">{t('ArrayHealthDialog.noLongerDegraded')}</div>
          ) : (
            reasons.map((reason) => (
              <div key={reason.key} className="import-warning import-warning--danger">
                <div className="import-warning__title">{reason.title}</div>
                <div className="import-warning__desc">{reason.detail}</div>
                {reason.diskId && (
                  <button type="button" className="btn" onClick={() => goToDisk(reason.diskId!)}>
                    {t('ArrayHealthDialog.viewDisk')}
                  </button>
                )}
                {reason.unlockAll && (
                  <button type="button" className="btn" onClick={() => setShowUnlockAll(true)}>
                    {t('ArrayHealthDialog.unlockAll')}
                  </button>
                )}
                {reason.startParityCheck &&
                  (status.resync.active ? (
                    <div className="toggle-row__desc">{t('ArrayHealthDialog.parityCheckRunning')}</div>
                  ) : (
                    <button type="button" className="btn" disabled={parityPending} onClick={() => parityAction('CORRECT')}>
                      {parityPending ? t('ArrayHealthDialog.starting') : t('ArrayHealthDialog.startCorrectingParityCheck')}
                    </button>
                  ))}
              </div>
            ))
          )}
        </div>
      </div>

      {showUnlockAll && <UnlockAllDialog disks={lockedDisks} onClose={() => setShowUnlockAll(false)} onDone={refresh} />}
    </>
  );
}
