import { useTranslation } from 'react-i18next';
import { useArrayStatus } from '../../state/useArrayStatus';

/** Global modal for the "Docker/LXC is holding a disk open" stop-array retry prompt. The header's
 *  Stop Array button is reachable from every page, not just Dashboard/Disks - an inline banner
 *  tied to those two pages' own layout left nowhere to render this when the stop was triggered
 *  from elsewhere (e.g. Settings): the underlying context state still got set correctly, just
 *  nothing was mounted to show it. Mounted once in AppShell instead, so it works regardless of
 *  which page is active. */
export function ArrayStopBlockedModal() {
  const { t } = useTranslation('shared');
  const { stopBlockedByContainers, arrayPending, toggleArray, dismissActionError } = useArrayStatus();
  if (!stopBlockedByContainers) return null;

  const close = () => {
    if (arrayPending) return;
    dismissActionError();
  };

  return (
    <>
      <div className="detail-overlay" onClick={close} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{t('ArrayStopBlockedModal.title')}</div>
          <button type="button" className="detail-panel__close" onClick={close} aria-label={t('ArrayStopBlockedModal.close')}>
            &#10005;
          </button>
        </div>
        <div className="dialog__body">
          <p className="status-note" style={{ margin: '0 0 8px' }}>
            {t('ArrayStopBlockedModal.stopBlockedMessage')}
          </p>
          <div className="dialog__actions">
            <button type="button" className="btn" disabled={arrayPending} onClick={close}>
              {t('ArrayStopBlockedModal.cancel')}
            </button>
            <button type="button" className="btn btn--danger" disabled={arrayPending} onClick={() => toggleArray(true)}>
              {arrayPending ? t('ArrayStopBlockedModal.stopping') : t('ArrayStopBlockedModal.stopAndRetry')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
