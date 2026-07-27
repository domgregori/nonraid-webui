import { ActivityCard } from '../components/dashboard/ActivityCard';
import { ArrayDisks } from '../components/dashboard/ArrayDisks';
import { ParityCheckCard } from '../components/dashboard/ParityCheckCard';
import { SettingsQuickCard } from '../components/dashboard/SettingsQuickCard';
import { StatCards } from '../components/dashboard/StatCards';
import { SystemCard } from '../components/dashboard/SystemCard';

export function DashboardPage() {
  return (
    <div className="dashboard">
      <div className="dashboard__main">
        <StatCards />
        <ParityCheckCard />
        <ArrayDisks />
      </div>

      <div className="dashboard__sidebar">
        <SystemCard />
        <SettingsQuickCard />
        <ActivityCard />
      </div>
    </div>
  );
}
