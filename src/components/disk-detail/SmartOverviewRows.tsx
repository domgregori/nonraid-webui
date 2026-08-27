import { useTranslation } from 'react-i18next';
import { COLORS } from '../../styles/colors';
import type { SmartAttributes } from '../../types/smart';
import { formatBytesHuman } from '../../utils/format';

interface SmartOverviewRowsProps {
  attributes: SmartAttributes;
  /** "SSD"/"HDD"/"-" - omitted (Type row shows RPM only, if any) when the caller has no rotational
   *  type handy, e.g. the boot disk panel, which doesn't fetch lsblk's ROTA flag for its own device. */
  typeLabel?: string;
}

/** The read-only info rows shared by the array-disk detail panel and the boot disk detail panel -
 *  kept as one component so the two don't drift into two different layouts for the same data. */
export function SmartOverviewRows({ attributes, typeLabel }: SmartOverviewRowsProps) {
  const { t } = useTranslation('diskDetail');
  return (
    <div className="detail-rows">
      <div className="detail-row">
        <span className="detail-row__label">{t('SmartOverviewRows.model')}</span>
        <span className="detail-row__value">{attributes.model ?? '-'}</span>
      </div>
      <div className="detail-row">
        <span className="detail-row__label">{t('SmartOverviewRows.serial')}</span>
        <span className="detail-row__value">{attributes.serial ?? '-'}</span>
      </div>
      <div className="detail-row">
        <span className="detail-row__label">{t('SmartOverviewRows.capacity')}</span>
        <span className="detail-row__value">{attributes.capacityBytes != null ? formatBytesHuman(attributes.capacityBytes) : '-'}</span>
      </div>
      <div className="detail-row">
        <span className="detail-row__label">{t('SmartOverviewRows.health')}</span>
        <span
          className="detail-row__value"
          style={{ color: attributes.health === 'failed' ? COLORS.red : attributes.health === 'passed' ? COLORS.green : undefined }}
        >
          {attributes.health === 'failed' ? t('SmartOverviewRows.failed') : attributes.health === 'passed' ? t('SmartOverviewRows.passed') : '-'}
        </span>
      </div>
      {(typeLabel || attributes.rotationRpm != null) && (
        <div className="detail-row">
          <span className="detail-row__label">{t('SmartOverviewRows.type')}</span>
          <span className="detail-row__value">
            {typeLabel ?? ''}
            {attributes.rotationRpm != null
              ? `${typeLabel ? ' · ' : ''}${attributes.rotationRpm} RPM`
              : // Confirmed live: some drives (e.g. this project's own WD Blue test disk) don't
                // report rotation rate at all - not through smartctl JSON, smartctl's classic
                // text output, or hdparm's raw ATA IDENTIFY data. Says so explicitly rather than
                // silently omitting RPM, which reads as broken rather than as the drive's own gap.
                typeLabel === 'HDD'
                ? ` (${t('SmartOverviewRows.rpmNotReported')})`
                : ''}
          </span>
        </div>
      )}
      {typeLabel !== 'SSD' && (
        <div className="detail-row">
          <span className="detail-row__label">{t('SmartOverviewRows.spinState')}</span>
          <span className="detail-row__value">
            {attributes.spinState === 'standby' ? t('SmartOverviewRows.standby') : attributes.spinState === 'active' ? t('SmartOverviewRows.active') : '-'}
          </span>
        </div>
      )}
      <div className="detail-row">
        <span className="detail-row__label">{t('SmartOverviewRows.powerOnHours')}</span>
        <span className="detail-row__value">{attributes.powerOnHours ?? '-'}</span>
      </div>
      <div className="detail-row">
        <span className="detail-row__label">{t('SmartOverviewRows.powerCycles')}</span>
        <span className="detail-row__value">{attributes.powerCycleCount ?? '-'}</span>
      </div>
      <div className="detail-row">
        <span className="detail-row__label">{t('SmartOverviewRows.reallocatedSectors')}</span>
        <span className="detail-row__value">{attributes.reallocatedSectors ?? '-'}</span>
      </div>
      <div className="detail-row">
        <span className="detail-row__label">{t('SmartOverviewRows.pendingSectors')}</span>
        <span className="detail-row__value">{attributes.pendingSectors ?? '-'}</span>
      </div>
      <div className="detail-row">
        <span className="detail-row__label">{t('SmartOverviewRows.uncorrectable')}</span>
        <span className="detail-row__value">{attributes.uncorrectableSectors ?? '-'}</span>
      </div>
    </div>
  );
}
