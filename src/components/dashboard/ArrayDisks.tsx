import { deriveDisks } from '../../selectors/disks';
import { useArrayStatus } from '../../state/useArrayStatus';
import { DataDiskCard, ParityDiskCard } from './DiskCard';

export function ArrayDisks() {
  const { status, temps, selectDisk } = useArrayStatus();
  if (!status) return null;

  const { parity, data } = deriveDisks(status, temps);

  return (
    <div>
      <div className="eyebrow disk-section-label">Array Disks</div>

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
