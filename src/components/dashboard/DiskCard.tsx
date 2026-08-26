import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../../styles/colors';
import type { ParityViewModel } from '../../types/parity';
import type { DiskViewModel } from '../../types';

/** Arrow indicator for spun-up vs standby - HDD only (SSDs don't spin, showing this would be
 *  misleading) and only once the bulk /smart/spin-states poll has resolved a real value. */
function SpinIndicator({ disk }: { disk: DiskViewModel }) {
  const { t } = useTranslation('dashboard');
  if (disk.typeLabel !== 'HDD' || !disk.spinState || disk.spinState === 'unknown') return null;
  const active = disk.spinState === 'active';
  return (
    <span className="disk-card__spin" style={{ color: active ? COLORS.textSecondary : COLORS.textDim }}>
      {active ? '▲' : '▼'} {active ? t('DiskCard.spinActive') : t('DiskCard.spinStandby')}
    </span>
  );
}

function DeviceLine({ disk }: { disk: DiskViewModel }) {
  return <div className="disk-card__device">{disk.customLabel ? `${disk.customLabel} · ${disk.device}` : disk.device}</div>;
}

interface DiskCardProps {
  disk: DiskViewModel;
  onClick: () => void;
}

interface DataDiskCardProps extends DiskCardProps {
  /** Set only on the one disk currently being cleared - see ArrayDisks. Swaps this card's normal
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
      <DeviceLine disk={disk} />
      <div className="disk-card__row">
        <span>{disk.sizeLabel}</span>
        <span>{disk.tempLabel}</span>
      </div>
      <div className="disk-card__row--sub">
        <span className="disk-card__health" style={{ color: disk.healthColor }}>
          <span className="disk-card__health-dot" style={{ background: disk.healthColor }} />
          {disk.healthLabel}
        </span>
        <SpinIndicator disk={disk} />
      </div>
    </div>
  );
}

export function DataDiskCard({ disk, onClick, clearing }: DataDiskCardProps) {
  const { t } = useTranslation('dashboard');
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
            {t('DiskCard.cancel')}
          </button>
        </div>
        <div className="disk-card__device">{disk.device}</div>
        <div className="progress-track">
          <div className="progress-track__fill" style={{ width: `${clearing.progressPct}%`, background: clearing.barColor }} />
        </div>
        <div className="disk-card__row--sub">
          <span>{t('DiskCard.clearing', { pct: clearing.progressPct })}</span>
          <span>{clearing.speedText}</span>
        </div>
        <div className="disk-card__row--sub">
          <span>{clearing.etaCompact}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="disk-card disk-card--data" style={{ borderColor: disk.borderColor }} onClick={onClick}>
      <div className="disk-card__head">
        <span className="disk-card__label">{disk.label}</span>
        <span className="disk-card__status" style={{ color: disk.statusColor }}>
          <span className="disk-card__status-dot" style={{ background: disk.statusColor }} />
          {disk.statusLabel}
        </span>
      </div>
      <DeviceLine disk={disk} />
      {disk.needsFormat && (
        <div className="disk-card__row--sub" style={{ color: COLORS.amber }}>
          {t('DiskCard.needsFormatting')}
        </div>
      )}
      <div className="progress-track">
        <div className="progress-track__fill" style={{ width: disk.barWidth, background: disk.barColor }} />
      </div>
      <div className="disk-card__row">
        <span>{disk.sizeLabel}</span>
        <span>{disk.usedLabel}</span>
      </div>
      <div className="disk-card__row--sub">
        <span>{t('DiskCard.free', { free: disk.freeLabel })}</span>
        <span style={{ color: disk.tempColor }}>{disk.tempLabel}</span>
      </div>
      <div className="disk-card__row--sub">
        <span>{disk.typeLabel}</span>
        <SpinIndicator disk={disk} />
      </div>
      <div className="disk-card__row--sub">
        <span className="disk-card__health" style={{ color: disk.healthColor }}>
          <span className="disk-card__health-dot" style={{ background: disk.healthColor }} />
          {disk.healthLabel}
        </span>
      </div>
    </div>
  );
}
