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
import { UnlockAllDialog } from '../components/disk-detail/UnlockAllDialog';
import { ArrayActionErrorBanner } from '../components/shared/ArrayActionErrorBanner';
import { useSettings } from '../hooks/useSettings';
import { deriveDisks } from '../selectors/disks';
import { useArrayStatus } from '../state/useArrayStatus';

export function DisksPage() {
  const { t } = useTranslation('pages');
  const { status, temps, loadState, error, actionError, stopBlockedByContainers, refresh } = useArrayStatus();
  const { settings } = useSettings();
  const [showBootDisk, setShowBootDisk] = useState(false);
  const [showUnlockAll, setShowUnlockAll] = useState(false);

  // Same diskLabels thread ArrayDisks already passes through - see its own comment on why a
  // locked disk's custom nickname matters here more than most places.
  const locked = status ? deriveDisks(status, temps, {}, {}, {}, {}, settings?.diskLabels ?? {}).data.filter((d) => d.encryption === 'luks-locked') : [];

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">{t('DisksPage.title')}</div>
      </div>

      {loadState === 'loading' && !status && <div className="status-note">{t('DisksPage.loadingArrayStatus')}</div>}
      {error && <div className="status-note status-note--error">{error}</div>}
      {actionError && <ArrayActionErrorBanner actionError={actionError} stopBlockedByContainers={stopBlockedByContainers} />}

      {locked.length > 0 && (
        <div className="status-note status-note--error" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span>{t('DisksPage.disksLocked', { count: locked.length })}</span>
          <button type="button" className="btn btn--primary" onClick={() => setShowUnlockAll(true)}>
            {t('DisksPage.unlockAll')}
          </button>
        </div>
      )}

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
      {showUnlockAll && <UnlockAllDialog disks={locked} onClose={() => setShowUnlockAll(false)} onDone={refresh} />}
    </div>
  );
}
