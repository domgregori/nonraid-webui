import { useTranslation } from 'react-i18next';
import { deriveDegradedReasons, isDegraded } from '../../selectors/status';
import { useArrayStatus } from '../../state/useArrayStatus';

interface ArrayHealthDialogProps {
  onClose: () => void;
}

/** Opened from the header's DEGRADED pill (see ArrayStatusPill) - explains each reason
 *  deriveDegradedReasons found and, where there's a safe one-click fix, offers a button for it. */
export function ArrayHealthDialog({ onClose }: ArrayHealthDialogProps) {
  const { t } = useTranslation('layout');
  const { status, parityPending, parityAction, selectDisk } = useArrayStatus();
  if (!status) return null;

  const goToDisk = (diskId: string) => {
    selectDisk(diskId);
    onClose();
  };

  const reasons = deriveDegradedReasons(status);

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
    </>
  );
}
