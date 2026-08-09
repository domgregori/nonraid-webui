import { COLORS } from '../../styles/colors';
import type { SmartAttributes } from '../../types/smart';
import { formatBytesHuman } from '../../utils/format';

interface SmartOverviewRowsProps {
  attributes: SmartAttributes;
  /** "SSD"/"HDD"/"—" — omitted (Type row shows RPM only, if any) when the caller has no rotational
   *  type handy, e.g. the boot disk panel, which doesn't fetch lsblk's ROTA flag for its own device. */
  typeLabel?: string;
}

/** The read-only info rows shared by the array-disk detail panel and the boot disk detail panel —
 *  kept as one component so the two don't drift into two different layouts for the same data. */
export function SmartOverviewRows({ attributes, typeLabel }: SmartOverviewRowsProps) {
  return (
    <div className="detail-rows">
      <div className="detail-row">
        <span className="detail-row__label">Model</span>
        <span className="detail-row__value">{attributes.model ?? '—'}</span>
      </div>
      <div className="detail-row">
        <span className="detail-row__label">Serial</span>
        <span className="detail-row__value">{attributes.serial ?? '—'}</span>
      </div>
      <div className="detail-row">
        <span className="detail-row__label">UUID</span>
        <span className="detail-row__value">{attributes.wwn ?? '—'}</span>
      </div>
      <div className="detail-row">
        <span className="detail-row__label">Capacity</span>
        <span className="detail-row__value">{attributes.capacityBytes != null ? formatBytesHuman(attributes.capacityBytes) : '—'}</span>
      </div>
      <div className="detail-row">
        <span className="detail-row__label">Health</span>
        <span
          className="detail-row__value"
          style={{ color: attributes.health === 'failed' ? COLORS.red : attributes.health === 'passed' ? COLORS.green : undefined }}
        >
          {attributes.health === 'failed' ? 'FAILED' : attributes.health === 'passed' ? 'Passed' : '—'}
        </span>
      </div>
      {(typeLabel || attributes.rotationRpm != null) && (
        <div className="detail-row">
          <span className="detail-row__label">Type</span>
          <span className="detail-row__value">
            {typeLabel ?? ''}
            {attributes.rotationRpm != null ? `${typeLabel ? ' · ' : ''}${attributes.rotationRpm} RPM` : ''}
          </span>
        </div>
      )}
      <div className="detail-row">
        <span className="detail-row__label">Spin State</span>
        <span className="detail-row__value">
          {attributes.spinState === 'standby' ? 'Standby (spun down)' : attributes.spinState === 'active' ? 'Active (spun up)' : '—'}
        </span>
      </div>
      <div className="detail-row">
        <span className="detail-row__label">Power-On Hours</span>
        <span className="detail-row__value">{attributes.powerOnHours ?? '—'}</span>
      </div>
      <div className="detail-row">
        <span className="detail-row__label">Power Cycles</span>
        <span className="detail-row__value">{attributes.powerCycleCount ?? '—'}</span>
      </div>
      <div className="detail-row">
        <span className="detail-row__label">Reallocated Sectors</span>
        <span className="detail-row__value">{attributes.reallocatedSectors ?? '—'}</span>
      </div>
      <div className="detail-row">
        <span className="detail-row__label">Pending Sectors</span>
        <span className="detail-row__value">{attributes.pendingSectors ?? '—'}</span>
      </div>
      <div className="detail-row">
        <span className="detail-row__label">Uncorrectable</span>
        <span className="detail-row__value">{attributes.uncorrectableSectors ?? '—'}</span>
      </div>
    </div>
  );
}
