import { deriveArrayStatus } from '../../selectors/status';
import { useArrayStatus } from '../../state/useArrayStatus';

export function ArrayStatusPill() {
  const { status } = useArrayStatus();
  const { text, color, pillBg } = deriveArrayStatus(status);

  return (
    <div className="status-pill" style={{ borderColor: color, background: pillBg }}>
      <div className="status-dot" style={{ background: color }} />
      <span className="status-pill__text" style={{ color }}>
        {text}
      </span>
    </div>
  );
}
