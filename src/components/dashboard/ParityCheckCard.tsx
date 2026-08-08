import { deriveParityViewModel } from '../../selectors/parity';
import { useArrayStatus } from '../../state/useArrayStatus';
import { Card } from '../shared/Card';
import { ProgressBar } from '../shared/ProgressBar';

export function ParityCheckCard() {
  const { status, parityPending, parityAction } = useArrayStatus();
  if (!status) return null;

  const parity = deriveParityViewModel(status, parityPending, parityAction);
  // A new-disk clear reuses this same resync status but isn't a parity check — its progress
  // shows on the clearing disk's own card instead (see ArrayDisks).
  if (parity.isClearing) return null;

  return (
    <Card className="parity-card">
      <div className="parity-card__head">
        <div className="eyebrow">Parity Check</div>
        <div className="parity-card__actions">
          {parity.isRunning && (
            <>
              <button type="button" className="btn" disabled={parityPending} onClick={parity.pauseHandler}>
                {parity.pauseLabel}
              </button>
              <button type="button" className="btn btn--danger" disabled={parityPending} onClick={parity.cancelHandler}>
                Cancel
              </button>
            </>
          )}
          {parity.canStart && (
            <button type="button" className="btn--primary-sm" disabled={parityPending} onClick={parity.startHandler}>
              Start Parity Check
            </button>
          )}
        </div>
      </div>

      <ProgressBar pct={parity.progressPct} color={parity.barColor} height={8} />

      <div className="parity-card__meta">
        <span>{parity.progressLabel}</span>
        <span>Speed: {parity.speedText}</span>
        <span>{parity.etaText}</span>
      </div>
    </Card>
  );
}
