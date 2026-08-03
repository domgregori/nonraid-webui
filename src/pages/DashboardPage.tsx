import { ActivityCard } from '../components/dashboard/ActivityCard';
import { ArrayDisks } from '../components/dashboard/ArrayDisks';
import { ParityCheckCard } from '../components/dashboard/ParityCheckCard';
import { SettingsQuickCard } from '../components/dashboard/SettingsQuickCard';
import { StatCards } from '../components/dashboard/StatCards';
import { SystemCard } from '../components/dashboard/SystemCard';
import { useArrayStatus } from '../state/useArrayStatus';

export function DashboardPage() {
  const { status, loadState, error, actionError } = useArrayStatus();

  return (
    <div className="dashboard">
      <div className="dashboard__main">
        {loadState === 'loading' && !status && <div className="status-note">Loading array status…</div>}
        {error && <div className="status-note status-note--error">{error}</div>}
        {actionError && <div className="status-note status-note--error">{actionError}</div>}
        {status && (
          <>
            <StatCards />
            <ParityCheckCard />
            <ArrayDisks showManageLink />
          </>
        )}
      </div>

      <div className="dashboard__sidebar">
        <SystemCard />
        <SettingsQuickCard />
        <ActivityCard />
      </div>
    </div>
  );
}
