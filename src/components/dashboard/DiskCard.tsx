import type { MouseEvent } from 'react';
import type { ParityViewModel } from '../../types/parity';
import type { DiskViewModel } from '../../types';

interface DiskCardProps {
  disk: DiskViewModel;
  onClick: () => void;
}

interface DataDiskCardProps extends DiskCardProps {
  /** Set only on the one disk currently being cleared — see ArrayDisks. Swaps this card's normal
   *  used-space display for clear progress + pause/resume/cancel controls. */
  clearing?: ParityViewModel;
}

function stopPropagation<T>(handler: () => T): (e: MouseEvent) => void {
  return (e) => {
    e.stopPropagation();
    handler();
  };
}

export function ParityDiskCard({ disk, onClick }: DiskCardProps) {
  return (
    <div className="disk-card disk-card--parity" style={{ borderColor: disk.borderColor }} onClick={onClick}>
      <div className="disk-card__head">
        <span className="disk-card__label">{disk.label}</span>
        <span className="disk-card__status" style={{ color: disk.statusColor }}>
          <span className="disk-card__status-dot" style={{ background: disk.statusColor }} />
          {disk.statusLabel}
        </span>
      </div>
      <div className="disk-card__device">{disk.device}</div>
      <div className="disk-card__row">
        <span>{disk.sizeLabel}</span>
        <span>{disk.tempLabel}</span>
      </div>
    </div>
  );
}

export function DataDiskCard({ disk, onClick, clearing }: DataDiskCardProps) {
  if (clearing) {
    return (
      <div className="disk-card disk-card--data" style={{ borderColor: disk.borderColor }} onClick={onClick}>
        <div className="disk-card__head">
          <span className="disk-card__label">{disk.label}</span>
        </div>
        <div className="disk-card__clear-actions">
          <button type="button" className="btn" onClick={stopPropagation(clearing.pauseHandler)}>
            {clearing.pauseLabel}
          </button>
          <button type="button" className="btn btn--danger" onClick={stopPropagation(clearing.cancelHandler)}>
            Cancel
          </button>
        </div>
        <div className="disk-card__device">{disk.device}</div>
        <div className="progress-track">
          <div className="progress-track__fill" style={{ width: `${clearing.progressPct}%`, background: clearing.barColor }} />
        </div>
        <div className="disk-card__row--sub">
          <span>{clearing.progressLabel}</span>
          <span>{clearing.speedText}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="disk-card disk-card--data" style={{ borderColor: disk.borderColor }} onClick={onClick}>
      <div className="disk-card__head">
        <span className="disk-card__label">{disk.label}</span>
        <span className="disk-card__status-dot" style={{ background: disk.statusColor }} />
      </div>
      <div className="disk-card__device">{disk.device}</div>
      <div className="progress-track">
        <div className="progress-track__fill" style={{ width: disk.barWidth, background: disk.barColor }} />
      </div>
      <div className="disk-card__row">
        <span>{disk.sizeLabel}</span>
        <span>{disk.usedLabel}</span>
      </div>
      <div className="disk-card__row--sub">
        <span>{disk.fsType}</span>
        <span style={{ color: disk.tempColor }}>{disk.tempLabel}</span>
      </div>
    </div>
  );
}
