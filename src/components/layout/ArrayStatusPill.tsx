import { useState } from 'react';
import { deriveArrayStatus, isDegraded } from '../../selectors/status';
import { useArrayStatus } from '../../state/useArrayStatus';
import { ArrayHealthDialog } from './ArrayHealthDialog';

export function ArrayStatusPill() {
  const { status } = useArrayStatus();
  const { text, color, pillBg } = deriveArrayStatus(status);
  const [showDialog, setShowDialog] = useState(false);
  const clickable = !!status && isDegraded(status);

  return (
    <>
      <button
        type="button"
        className="status-pill"
        style={{ borderColor: color, background: pillBg, cursor: clickable ? 'pointer' : 'default' }}
        onClick={() => setShowDialog(true)}
        disabled={!clickable}
      >
        <div className="status-dot" style={{ background: color }} />
        <span className="status-pill__text" style={{ color }}>
          {text}
        </span>
      </button>
      {showDialog && <ArrayHealthDialog onClose={() => setShowDialog(false)} />}
    </>
  );
}
