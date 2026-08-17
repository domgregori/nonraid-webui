import { ArrayDisks } from '../components/dashboard/ArrayDisks';
import { ArrayErrorCard } from '../components/dashboard/ArrayErrorCard';
import { CacheCard } from '../components/dashboard/CacheCard';
import { CacheMoverProgressCard } from '../components/dashboard/CacheMoverProgressCard';
import { DiskQueueCard } from '../components/dashboard/DiskQueueCard';
import { DockerWidgetCard } from '../components/dashboard/DockerWidgetCard';
import { LxcWidgetCard } from '../components/dashboard/LxcWidgetCard';
import { ParityCheckCard } from '../components/dashboard/ParityCheckCard';
import { SharesCard } from '../components/dashboard/SharesCard';
import { StatCards } from '../components/dashboard/StatCards';
import { SystemCard } from '../components/dashboard/SystemCard';
import { ArrayActionErrorBanner } from '../components/shared/ArrayActionErrorBanner';
import { useArrayStatus } from '../state/useArrayStatus';

export function DashboardPage() {
  const { status, loadState, error, actionError, stopBlockedByContainers, arrayPending, toggleArray } = useArrayStatus();

  return (
    <div className="dashboard">
      <div className="dashboard__main">
        {loadState === 'loading' && !status && <div className="status-note">Loading array status…</div>}
        {/* 'not-configured' (no array ever created) is expected on a fresh install - OnboardingGate
            covers this with the setup wizard instead of a scary error banner. */}
        {loadState === 'error' && error && <div className="status-note status-note--error">{error}</div>}
        {actionError && (
          <ArrayActionErrorBanner
            actionError={actionError}
            stopBlockedByContainers={stopBlockedByContainers}
            arrayPending={arrayPending}
            onRetryWithStopContainers={() => toggleArray(true)}
          />
        )}
        {status && (
          <>
            <StatCards />
            <ArrayErrorCard />
            <ParityCheckCard />
            <DiskQueueCard />
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
      </div>
    </div>
  );
}
