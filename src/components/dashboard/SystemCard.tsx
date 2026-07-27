import { COLORS } from '../../styles/colors';
import { useSystemStats } from '../../hooks/useSystemStats';
import { formatMemLabel } from '../../utils/format';
import { Card } from '../shared/Card';
import { ProgressBar } from '../shared/ProgressBar';

export function SystemCard() {
  const stats = useSystemStats();
  if (!stats) return null;

  const memPct = Math.round((stats.memUsedBytes / stats.memTotalBytes) * 100);

  return (
    <Card className="bars-card">
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        System
      </div>
      <div>
        <div className="bar-row__head">
          <span>CPU</span>
          <span className="bar-row__value">{Math.round(stats.cpuPercent)}%</span>
        </div>
        <ProgressBar pct={stats.cpuPercent} color={COLORS.blue} />
      </div>
      <div>
        <div className="bar-row__head">
          <span>Memory</span>
          <span className="bar-row__value">{formatMemLabel(stats.memUsedBytes, stats.memTotalBytes)}</span>
        </div>
        <ProgressBar pct={memPct} color={COLORS.blue} />
      </div>
    </Card>
  );
}
