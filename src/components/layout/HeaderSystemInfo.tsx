import { useTranslation } from 'react-i18next';
import { useSystemStats } from '../../hooks/useSystemStats';
import { deriveCapacity, deriveDisks } from '../../selectors/disks';
import { useArrayStatus } from '../../state/useArrayStatus';
import { formatUptime } from '../../utils/format';

export function HeaderSystemInfo() {
  const { t } = useTranslation('layout');
  const { status, temps } = useArrayStatus();
  const stats = useSystemStats();

  const freeLabel = status
    ? t('HeaderSystemInfo.freeSuffix', {
        value: deriveCapacity(deriveDisks(status, temps).data, status.array.state === 'STARTED').freeLabel,
      })
    : '-';
  const memPct = stats ? Math.round((stats.memUsedBytes / stats.memTotalBytes) * 100) : null;
  const cpuTempLabel = typeof stats?.cpuTempCelsius === 'number' ? ` (${Math.round(stats.cpuTempCelsius)}°C)` : '';

  return (
    <div className="header__info">
      <span className="header__info-item header__info-item--host">{stats?.hostname ?? '-'}</span>
      <span className="header__info-divider">·</span>
      <span className="header__info-item">{stats ? t('HeaderSystemInfo.upLabel', { uptime: formatUptime(stats.uptimeSeconds) }) : '-'}</span>
      <span className="header__info-divider">·</span>
      <span className="header__info-item">{freeLabel}</span>
      <span className="header__info-divider">·</span>
      <span className="header__info-item">
        {t('HeaderSystemInfo.cpuLabel', { pct: stats ? Math.round(stats.cpuPercent) : '-', tempSuffix: cpuTempLabel })}
      </span>
      <span className="header__info-divider">·</span>
      <span className="header__info-item">{t('HeaderSystemInfo.memLabel', { pct: memPct ?? '-' })}</span>
    </div>
  );
}
