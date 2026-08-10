import { useState } from 'react';
import { useCacheStatus } from '../../hooks/useCacheStatus';
import { COLORS } from '../../styles/colors';
import type { CacheHealth } from '../../types/cacheApi';
import { Card } from '../shared/Card';
import { CacheReplaceDialog } from './CacheReplaceDialog';
import { CacheSetupDialog } from './CacheSetupDialog';

const HEALTH_LABEL: Record<CacheHealth, string> = {
  'not-configured': 'Not set up',
  healthy: 'Healthy',
  degraded: 'Degraded',
  unavailable: 'Unavailable',
};

function healthColor(health: CacheHealth): string {
  if (health === 'healthy') return COLORS.green;
  if (health === 'degraded') return COLORS.amber;
  if (health === 'unavailable') return COLORS.red;
  return COLORS.border;
}

/** Placed between Boot Disk and Unassigned Devices on the Disks page, matching Unraid's own
 *  dashboard ordering (see the cache pool plan). */
export function CacheSection() {
  const { status, refresh } = useCacheStatus();
  const [showSetup, setShowSetup] = useState(false);
  const [showReplace, setShowReplace] = useState(false);

  if (!status) return null;

  return (
    <div>
      <div className="disk-section-head">
        <div className="eyebrow disk-section-label">Cache</div>
      </div>

      {status.health === 'not-configured' ? (
        <Card>
          <div className="toggle-row__desc">
            No cache mirror set up. A cache pool is a mirrored pair of disks that share writes land on first — a
            scheduled mover then drains them onto the parity-protected array. Requires exactly two disks; a single
            disk can't be used as cache since it would have zero parity protection.
          </div>
          <div className="settings-field__row" style={{ marginTop: 10 }}>
            <button type="button" className="btn--primary-sm" onClick={() => setShowSetup(true)}>
              Set Up Cache Mirror
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
                Replace
              </button>
            )}
          </div>

          <div className="disk-row">
            {status.devices.map((d) => (
              <div
                key={d.devid}
                className="disk-card disk-card--data"
                style={{ borderTopColor: d.missing ? COLORS.red : d.smartHealth === 'failed' ? COLORS.red : COLORS.green }}
                title={d.missing ? 'Missing' : `SMART: ${d.smartHealth ?? 'unknown'}`}
              >
                <div className="disk-card__head">
                  <span className="disk-card__label">{d.missing ? `Missing (devid ${d.devid})` : (d.model ?? `Device ${d.devid}`)}</span>
                </div>
                <div className="disk-card__device">{d.path ?? '—'}</div>
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
