import { useSystemStats } from '../../hooks/useSystemStats';
import { COLORS } from '../../styles/colors';
import { formatMemLabel } from '../../utils/format';

interface BootDiskCardProps {
  onClick: () => void;
}

/** The disk nonraid-webui itself boots from - not part of the array, so it doesn't fit the
 *  parity/data disk model ArrayDisks uses. Driven by the same polling hook SystemCard already
 *  uses; returns null when detection failed, same soft-fail behavior as that card. */
export function BootDiskCard({ onClick }: BootDiskCardProps) {
  const stats = useSystemStats();
  const boot = stats?.bootDisk;
  if (!boot) return null;

  const usedPct = boot.usedBytes !== null && boot.totalBytes !== null ? Math.round((boot.usedBytes / boot.totalBytes) * 100) : null;

  return (
    <div className="disk-card disk-card--boot" onClick={onClick}>
      <div className="disk-card__head">
        <span className="disk-card__label">Boot Disk</span>
      </div>
      <div className="disk-card__device">{[boot.device, boot.model].filter(Boolean).join(' · ')}</div>
      {usedPct !== null && boot.usedBytes !== null && boot.totalBytes !== null && (
        <>
          <div className="progress-track">
            <div className="progress-track__fill" style={{ width: `${usedPct}%`, background: COLORS.blue }} />
          </div>
          <div className="disk-card__row">
            <span>{formatMemLabel(boot.usedBytes, boot.totalBytes)}</span>
            <span>{usedPct}%</span>
          </div>
        </>
      )}
      <div className="disk-card__row--sub">
        <span>{boot.filesystem ?? '-'}</span>
        <span>{boot.tempCelsius !== null ? `${Math.round(boot.tempCelsius)}°C` : '-'}</span>
      </div>
    </div>
  );
}
