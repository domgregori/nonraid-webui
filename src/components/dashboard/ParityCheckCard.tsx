import { deriveParityViewModel } from '../../selectors/parity';
import { useAppStore } from '../../state/useAppStore';
import { Card } from '../shared/Card';
import { ProgressBar } from '../shared/ProgressBar';

export function ParityCheckCard() {
  const { state, dispatch } = useAppStore();
  const parity = deriveParityViewModel(state.parity, state.arrayStarted, state.scenario, dispatch);

  return (
    <Card>
      <div className="parity-card__head">
        <div className="eyebrow">Parity Check</div>
        <div className="parity-card__actions">
          {parity.isRunning && (
            <>
              <button type="button" className="btn" onClick={parity.pauseHandler}>
                {parity.pauseLabel}
              </button>
              <button type="button" className="btn btn--danger" onClick={parity.cancelHandler}>
                Cancel
              </button>
            </>
          )}
          {parity.canStart && (
            <button type="button" className="btn--primary-sm" onClick={parity.startHandler}>
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
