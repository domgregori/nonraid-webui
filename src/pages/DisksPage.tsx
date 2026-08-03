import { ArrayDisks } from '../components/dashboard/ArrayDisks';
import { ParityCheckCard } from '../components/dashboard/ParityCheckCard';
import { useArrayStatus } from '../state/useArrayStatus';

export function DisksPage() {
  const { status, loadState, error, actionError } = useArrayStatus();

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">Disks</div>
      </div>

      {loadState === 'loading' && !status && <div className="status-note">Loading array status…</div>}
      {error && <div className="status-note status-note--error">{error}</div>}
      {actionError && <div className="status-note status-note--error">{actionError}</div>}

      {status && (
        <div className="disks-page">
          <ParityCheckCard />
          <ArrayDisks />
        </div>
      )}
    </div>
  );
}
