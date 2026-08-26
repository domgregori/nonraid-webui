import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { deriveDisks } from '../../selectors/disks';
import { deriveParityViewModel } from '../../selectors/parity';
import { useArrayStatus } from '../../state/useArrayStatus';
import { DataDiskCard, ParityDiskCard } from './DiskCard';

interface ArrayDisksProps {
  showManageLink?: boolean;
}

export function ArrayDisks({ showManageLink }: ArrayDisksProps = {}) {
  const { t } = useTranslation('dashboard');
  const { status, temps, diskHealths, diskTypes, selectDisk, parityPending, parityAction } = useArrayStatus();
  if (!status) return null;

  const { parity, data } = deriveDisks(status, temps, diskHealths, diskTypes);
  // A new-disk clear reuses the same resync status a parity check would - reuse the same view
  // model, just route it to the clearing disk's own card instead of the Parity Check card. Only
  // once the clear is actually running, though (see ParityCheckCard's own comment) - while it's
  // merely queued, this card has no Start control of its own (Pause/Cancel assume something's
  // already going), so the disk stays on its normal card (showing its plain "New" status) and the
  // Parity Check card is where Start actually lives.
  const clearingView = deriveParityViewModel(status, parityPending, parityAction);
  const clearingDiskId =
    clearingView.isClearing && clearingView.isRunning
      ? data.find((d) => d.rawStatus === 'DISK_NEW' || d.rawStatus === 'DISK_DSBL_NEW')?.id
      : undefined;

  return (
    <div>
      <div className="disk-section-head">
        <div className="eyebrow disk-section-label">{t('ArrayDisks.arrayDisks')}</div>
        {showManageLink && (
          <Link to="/disks" className="disk-section-link">
            {t('ArrayDisks.manageDisks')} &rarr;
          </Link>
        )}
      </div>

      <div className="disk-row">
        {parity.map((disk) => (
          <ParityDiskCard key={disk.id} disk={disk} onClick={() => selectDisk(disk.id)} />
        ))}
      </div>

      <div className="disk-grid">
        {data.map((disk) => (
          <DataDiskCard
            key={disk.id}
            disk={disk}
            onClick={() => selectDisk(disk.id)}
            clearing={disk.id === clearingDiskId ? clearingView : undefined}
          />
        ))}
      </div>
    </div>
  );
}
