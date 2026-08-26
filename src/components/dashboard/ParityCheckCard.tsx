import { useTranslation } from 'react-i18next';
import { deriveParityViewModel } from '../../selectors/parity';
import { useArrayStatus } from '../../state/useArrayStatus';
import { Card } from '../shared/Card';
import { ProgressBar } from '../shared/ProgressBar';
import { ReloadDriverPrompt } from '../shared/ReloadDriverPrompt';

export function ParityCheckCard() {
  const { t } = useTranslation('dashboard');
  const { status, parityPending, parityAction, refresh } = useArrayStatus();
  if (!status) return null;

  const parity = deriveParityViewModel(status, parityPending, parityAction);
  // A new-disk clear reuses this same resync status but isn't a parity check - once it's actually
  // running, its progress shows on the clearing disk's own card instead (see ArrayDisks). But
  // resync.action is set the moment a clear is *queued*, before it's active - hiding this card for
  // that pending state too left no "Start" button reachable anywhere (DataDiskCard's clearing view
  // only has Pause/Cancel, which assume something's already running) - confirmed live: the pill
  // read "CLEARING PENDING" with nmdctl itself saying to run `nmdctl check` to start it, and
  // nothing in the UI could trigger that. parityCheck('CORRECT') already substitutes the right
  // nmdctl subcommand for a pending clear (see realClient.ts), so this button works correctly for
  // that case too - it just needed to stay visible.
  if (parity.isClearing && parity.isRunning) return null;

  return (
    <Card className="parity-card">
      <div className="parity-card__head">
        <div className="eyebrow">{parity.isClearing ? t('ParityCheckCard.newDisk') : t('ParityCheckCard.parityCheck')}</div>
        <div className="parity-card__actions">
          {parity.isRunning && (
            <>
              <button type="button" className="btn" disabled={parityPending} onClick={parity.pauseHandler}>
                {parity.pauseLabel}
              </button>
              <button type="button" className="btn btn--danger" disabled={parityPending} onClick={parity.cancelHandler}>
                {t('ParityCheckCard.cancel')}
              </button>
            </>
          )}
          {parity.canStart && (
            <button type="button" className="btn--primary-sm" disabled={parityPending} onClick={parity.startHandler}>
              {parity.isClearing ? t('ParityCheckCard.startClearing') : t('ParityCheckCard.startParityCheck')}
            </button>
          )}
        </div>
      </div>

      <ProgressBar pct={parity.progressPct} color={parity.barColor} height={8} />

      <div className="parity-card__meta">
        <span>{parity.progressLabel}</span>
        <span>{t('ParityCheckCard.speed', { speed: parity.speedText })}</span>
        <span>{parity.etaText}</span>
      </div>

      {parity.needsDriverReload && (
        <ReloadDriverPrompt
          description={t('ParityCheckCard.reloadDriverDesc')}
          onReloaded={refresh}
        />
      )}
    </Card>
  );
}
