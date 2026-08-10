import { useState } from 'react';
import { ArrayDisks } from '../components/dashboard/ArrayDisks';
import { BootDiskCard } from '../components/dashboard/BootDiskCard';
import { EmptyDiskProgressCard } from '../components/dashboard/EmptyDiskProgressCard';
import { ParityCheckCard } from '../components/dashboard/ParityCheckCard';
import { BootDiskDetailPanel } from '../components/disk-detail/BootDiskDetailPanel';
import { CacheSection } from '../components/disk-detail/CacheSection';
import { UnassignedDevicesCard } from '../components/disk-detail/UnassignedDevicesCard';
import { useArrayStatus } from '../state/useArrayStatus';

export function DisksPage() {
  const { status, loadState, error, actionError } = useArrayStatus();
  const [showBootDisk, setShowBootDisk] = useState(false);

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
          <EmptyDiskProgressCard />
          <ArrayDisks />

          <div>
            <div className="disk-section-head">
              <div className="eyebrow disk-section-label">Boot Disk</div>
            </div>
            <div className="disk-row">
              <BootDiskCard onClick={() => setShowBootDisk(true)} />
            </div>
          </div>

          <CacheSection />

          <UnassignedDevicesCard />
        </div>
      )}

      {showBootDisk && <BootDiskDetailPanel onClose={() => setShowBootDisk(false)} />}
    </div>
  );
}
