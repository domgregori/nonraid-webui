import { Link } from 'react-router-dom';
import { deriveDisks } from '../../selectors/disks';
import { useArrayStatus } from '../../state/useArrayStatus';
import { DataDiskCard, ParityDiskCard } from './DiskCard';

interface ArrayDisksProps {
  showManageLink?: boolean;
}

export function ArrayDisks({ showManageLink }: ArrayDisksProps = {}) {
  const { status, temps, selectDisk } = useArrayStatus();
  if (!status) return null;

  const { parity, data } = deriveDisks(status, temps);

  return (
    <div>
      <div className="disk-section-head">
        <div className="eyebrow disk-section-label">Array Disks</div>
        {showManageLink && (
          <Link to="/disks" className="disk-section-link">
            Manage disks &rarr;
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
          <DataDiskCard key={disk.id} disk={disk} onClick={() => selectDisk(disk.id)} />
        ))}
      </div>
    </div>
  );
}
