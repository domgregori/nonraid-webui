import { deriveArrayStatus } from '../../selectors/status';
import { useAppStore } from '../../state/useAppStore';

export function ArrayStatusPill() {
  const { state } = useAppStore();
  const { text, color, pillBg } = deriveArrayStatus(state.arrayStarted, state.scenario, state.parity);

  return (
    <div className="status-pill" style={{ borderColor: color, background: pillBg }}>
      <div className="status-dot" style={{ background: color }} />
      <span className="status-pill__text" style={{ color }}>
        {text}
      </span>
    </div>
  );
}
