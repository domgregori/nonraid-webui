import { useState } from 'react';
import { Link } from 'react-router-dom';
import { cacheApi } from '../../api/cacheApi';
import { useCacheStatus } from '../../hooks/useCacheStatus';
import { COLORS } from '../../styles/colors';
import type { CacheHealth } from '../../types/cacheApi';
import { formatBytesHuman } from '../../utils/format';
import { Card } from '../shared/Card';
import { ProgressBar } from '../shared/ProgressBar';

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

// Hidden entirely until a mirror exists - same "nothing to show yet" treatment ParityCheckCard
// gives a state that doesn't apply right now, rather than a permanent empty card on every install.
export function CacheCard() {
  const { status } = useCacheStatus();
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  if (!status || status.health === 'not-configured') return null;

  const color = healthColor(status.health);
  const usedPct = status.usedBytes != null && status.totalBytes ? (status.usedBytes / status.totalBytes) * 100 : 0;

  const handleMoveNow = async () => {
    setMoving(true);
    setMoveError(null);
    try {
      await cacheApi.runMover();
    } catch (err) {
      setMoveError((err as Error).message);
    } finally {
      setMoving(false);
    }
  };

  return (
    <Card>
      <div className="disk-section-head">
        <div className="eyebrow disk-section-label">Cache</div>
        <Link to="/disks" className="disk-section-link">
          Manage &rarr;
        </Link>
      </div>

      <div className="parity-card__head">
        <span className="disk-card__status" style={{ color }}>
          <span className="disk-card__status-dot" style={{ background: color }} />
          {HEALTH_LABEL[status.health]}
        </span>
        <div className="parity-card__actions">
          <span className="toggle-row__desc">{status.enabled ? 'In use by shares' : 'Not in use by shares'}</span>
          <button
            type="button"
            className="btn"
            disabled={moving}
            onClick={handleMoveNow}
            title="Files currently open (e.g. by a running Docker container) are skipped rather than failing the whole move."
          >
            {moving ? 'Starting…' : 'Move Now'}
          </button>
        </div>
      </div>
      {moveError && <div className="status-note status-note--error">{moveError}</div>}

      {status.usedBytes != null && status.totalBytes != null && (
        <>
          <ProgressBar pct={usedPct} color={COLORS.blue} height={8} />
          <div className="parity-card__meta">
            <span>
              {formatBytesHuman(status.usedBytes)} / {formatBytesHuman(status.totalBytes)} used
            </span>
          </div>
        </>
      )}

      <div className="disk-row" style={{ marginTop: 10 }}>
        {status.devices.map((d) => (
          <div key={d.devid} className="disk-card disk-card--data" style={{ borderTopColor: d.missing ? COLORS.red : healthColor('healthy') }}>
            <div className="disk-card__head">
              <span className="disk-card__label">{d.missing ? 'Missing' : (d.model ?? `Device ${d.devid}`)}</span>
            </div>
            <div className="disk-card__device">{d.path ?? '-'}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}
