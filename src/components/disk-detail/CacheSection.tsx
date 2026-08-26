import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCacheStatus } from '../../hooks/useCacheStatus';
import { COLORS } from '../../styles/colors';
import type { CacheHealth } from '../../types/cacheApi';
import { Card } from '../shared/Card';
import { CacheReplaceDialog } from './CacheReplaceDialog';
import { CacheSetupDialog } from './CacheSetupDialog';

function healthColor(health: CacheHealth): string {
  if (health === 'healthy') return COLORS.green;
  if (health === 'degraded') return COLORS.amber;
  if (health === 'unavailable') return COLORS.red;
  return COLORS.border;
}

/** Placed between Boot Disk and Unassigned Devices on the Disks page, matching the conventional
 *  dashboard ordering other array-management webGUIs use (see the cache pool plan). */
export function CacheSection() {
  const { t } = useTranslation('diskDetail');
  const { status, refresh } = useCacheStatus();
  const [showSetup, setShowSetup] = useState(false);
  const [showReplace, setShowReplace] = useState(false);

  if (!status) return null;

  const HEALTH_LABEL: Record<CacheHealth, string> = {
    'not-configured': t('CacheSection.healthNotConfigured'),
    healthy: t('CacheSection.healthHealthy'),
    degraded: t('CacheSection.healthDegraded'),
    unavailable: t('CacheSection.healthUnavailable'),
  };

  return (
    <div>
      <div className="disk-section-head">
        <div className="eyebrow disk-section-label">{t('CacheSection.cache')}</div>
      </div>

      {status.health === 'not-configured' ? (
        <Card>
          <div className="toggle-row__desc">
            {t('CacheSection.noCacheDesc')}
          </div>
          <div className="settings-field__row" style={{ marginTop: 10 }}>
            <button type="button" className="btn--primary-sm" onClick={() => setShowSetup(true)}>
              {t('CacheSection.setUpMirror')}
            </button>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="parity-card__head">
            <span className="disk-card__status" style={{ color: healthColor(status.health) }}>
              <span className="disk-card__status-dot" style={{ background: healthColor(status.health) }} />
              {HEALTH_LABEL[status.health]}
            </span>
            {status.health === 'degraded' && (
              <button type="button" className="btn btn--danger" onClick={() => setShowReplace(true)}>
                {t('CacheSection.replace')}
              </button>
            )}
          </div>

          <div className="disk-row">
            {status.devices.map((d) => (
              <div
                key={d.devid}
                className="disk-card disk-card--data"
                style={{ borderTopColor: d.missing ? COLORS.red : d.smartHealth === 'failed' ? COLORS.red : COLORS.green }}
                title={d.missing ? t('CacheSection.missing') : t('CacheSection.smartLabel', { health: d.smartHealth ?? t('CacheSection.unknown') })}
              >
                <div className="disk-card__head">
                  <span className="disk-card__label">{d.missing ? t('CacheSection.missingDevid', { devid: d.devid }) : (d.model ?? t('CacheSection.device', { devid: d.devid }))}</span>
                </div>
                <div className="disk-card__device">{d.path ?? '-'}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {showSetup && <CacheSetupDialog onClose={() => setShowSetup(false)} onDone={refresh} />}
      {showReplace && <CacheReplaceDialog onClose={() => setShowReplace(false)} onDone={refresh} />}
    </div>
  );
}
