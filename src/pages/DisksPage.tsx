import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrayDisks } from '../components/dashboard/ArrayDisks';
import { BootDiskCard } from '../components/dashboard/BootDiskCard';
import { DiskQueueCard } from '../components/dashboard/DiskQueueCard';
import { EmptyDiskProgressCard } from '../components/dashboard/EmptyDiskProgressCard';
import { ParityCheckCard } from '../components/dashboard/ParityCheckCard';
import { BootDiskDetailPanel } from '../components/disk-detail/BootDiskDetailPanel';
import { CacheSection } from '../components/disk-detail/CacheSection';
import { UnassignedDevicesCard } from '../components/disk-detail/UnassignedDevicesCard';
import { ArrayActionErrorBanner } from '../components/shared/ArrayActionErrorBanner';
import { useArrayStatus } from '../state/useArrayStatus';

export function DisksPage() {
  const { t } = useTranslation('pages');
  const { status, loadState, error, actionError, stopBlockedByContainers } = useArrayStatus();
  const [showBootDisk, setShowBootDisk] = useState(false);

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">{t('DisksPage.title')}</div>
      </div>

      {loadState === 'loading' && !status && <div className="status-note">{t('DisksPage.loadingArrayStatus')}</div>}
      {error && <div className="status-note status-note--error">{error}</div>}
      {actionError && <ArrayActionErrorBanner actionError={actionError} stopBlockedByContainers={stopBlockedByContainers} />}

      {status && (
        <div className="disks-page">
          <ParityCheckCard />
          <EmptyDiskProgressCard />
          <DiskQueueCard />
          <ArrayDisks />

          <div>
            <div className="disk-section-head">
              <div className="eyebrow disk-section-label">{t('DisksPage.bootDisk')}</div>
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
