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

/** Closed-padlock glyph - feather-icons' own "lock" path, same stroke-based style/viewBox
 *  NotificationBell's bell icon already uses elsewhere in this app. Used as a flat "this disk is
 *  LUKS-encrypted" badge rather than a live lock/unlock indicator - one glyph, present or absent,
 *  not two different icons for the locked vs. open states (the live locked/unlocked state is
 *  already surfaced elsewhere: LuksLockedCard on the dashboard, and LuksSection in the disk detail
 *  panel). */
function LockClosedIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/** "This disk is LUKS-encrypted" badge - an icon rather than a "· USB"-style text suffix
 *  (DeviceLine's transport tag) since it's meant to read as a status indicator at a glance, not
 *  another line of text. Same glyph and tooltip regardless of whether the disk is currently locked
 *  or unlocked (see LockClosedIcon's own comment on why) - just red while actually locked, since
 *  that's the state where the disk can't serve data at all, matching the same "must reflect real
 *  state, not overstate what it protects against" care the rest of this feature's UI copy takes
 *  (see docs/luks-support-scope.md's "Stored" section). */
function EncryptionIcon({ disk }: { disk: DiskViewModel }) {
  const { t } = useTranslation('dashboard');
  if (disk.encryption === 'none') return null;
  const locked = disk.encryption === 'luks-locked';
  return (
    <span
      className="disk-card__encryption"
      style={{ color: locked ? COLORS.red : COLORS.textDim }}
      title={locked ? t('DiskCard.locked') : t('DiskCard.encrypted')}
      aria-label={locked ? t('DiskCard.locked') : t('DiskCard.encrypted')}
    >
      <LockClosedIcon />
    </span>
  );
}

function DeviceLine({ disk }: { disk: DiskViewModel }) {
  const base = disk.customLabel ? `${disk.customLabel} · ${disk.device}` : disk.device;
  return (
    <div className="disk-card__device">
      {disk.isUsb ? `${base} · USB` : base}
      <EncryptionIcon disk={disk} />
    </div>
  );
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
