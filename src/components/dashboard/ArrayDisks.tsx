import { deriveDisks } from '../../selectors/disks';
import { useAppStore } from '../../state/useAppStore';
import { DataDiskCard, ParityDiskCard } from './DiskCard';

export function ArrayDisks() {
  const { state, dispatch } = useAppStore();
  const { parity, data } = deriveDisks(state);
  const select = (id: string) => dispatch({ type: 'SELECT_DISK', id });

  return (
    <div>
      <div className="eyebrow disk-section-label">Array Disks</div>

      <div className="disk-row">
        {parity.map((disk) => (
          <ParityDiskCard key={disk.id} disk={disk} onClick={() => select(disk.id)} />
        ))}
      </div>

      <div className="disk-grid">
        {data.map((disk) => (
          <DataDiskCard key={disk.id} disk={disk} onClick={() => select(disk.id)} />
        ))}
      </div>
    </div>
  );
}
