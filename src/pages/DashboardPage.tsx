import { ActivityCard } from '../components/dashboard/ActivityCard';
import { ArrayDisks } from '../components/dashboard/ArrayDisks';
import { CacheCard } from '../components/dashboard/CacheCard';
import { CacheMoverProgressCard } from '../components/dashboard/CacheMoverProgressCard';
import { DockerWidgetCard } from '../components/dashboard/DockerWidgetCard';
import { LxcWidgetCard } from '../components/dashboard/LxcWidgetCard';
import { ParityCheckCard } from '../components/dashboard/ParityCheckCard';
import { SharesCard } from '../components/dashboard/SharesCard';
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
            <CacheCard />
            <CacheMoverProgressCard />
            <ArrayDisks showManageLink />
          </>
        )}
        <DockerWidgetCard />
        <LxcWidgetCard />
      </div>

      <div className="dashboard__sidebar">
        <SystemCard />
        <SharesCard />
        <ActivityCard />
      </div>
    </div>
  );
}
