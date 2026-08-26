import { useTranslation } from 'react-i18next';
import { COLORS } from '../../styles/colors';
import { useSystemStats } from '../../hooks/useSystemStats';
import { formatMemLabel } from '../../utils/format';
import { Card } from '../shared/Card';
import { ProgressBar } from '../shared/ProgressBar';

export function SystemCard() {
  const { t } = useTranslation('dashboard');
  const stats = useSystemStats();
  if (!stats) return null;

  const memPct = Math.round((stats.memUsedBytes / stats.memTotalBytes) * 100);
  const boot = stats.bootDisk;
  const bootPct =
    boot && boot.usedBytes !== null && boot.totalBytes !== null ? Math.round((boot.usedBytes / boot.totalBytes) * 100) : null;

  return (
    <Card className="bars-card">
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        {t('SystemCard.system')}
      </div>
      <div>
        <div className="bar-row__head">
          <span>{t('SystemCard.cpu')}</span>
          <span className="bar-row__value">{Math.round(stats.cpuPercent)}%</span>
        </div>
        <ProgressBar pct={stats.cpuPercent} color={COLORS.blue} />
      </div>
      <div>
        <div className="bar-row__head">
          <span>{t('SystemCard.memory')}</span>
          <span className="bar-row__value">{formatMemLabel(stats.memUsedBytes, stats.memTotalBytes)}</span>
        </div>
        <ProgressBar pct={memPct} color={COLORS.blue} />
      </div>
      {boot && bootPct !== null && boot.usedBytes !== null && boot.totalBytes !== null && (
        <div>
          <div className="bar-row__head">
            <span>{t('SystemCard.bootDisk')}</span>
            <span className="bar-row__value">{formatMemLabel(boot.usedBytes, boot.totalBytes)}</span>
          </div>
          <ProgressBar pct={bootPct} color={COLORS.blue} />
          <div className="status-note" style={{ margin: '4px 0 0' }}>
            {[boot.device, boot.model, boot.filesystem, boot.tempCelsius !== null ? `${boot.tempCelsius}°C` : null]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
      )}
    </Card>
  );
}
