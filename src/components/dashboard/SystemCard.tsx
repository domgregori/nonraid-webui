import { COLORS } from '../../styles/colors';
import { Card } from '../shared/Card';
import { ProgressBar } from '../shared/ProgressBar';

const CPU_PCT = 14;
const RAM_PCT = 30;
const RAM_LABEL = '9.6 / 32 GB';

export function SystemCard() {
  return (
    <Card className="bars-card">
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        System
      </div>
      <div>
        <div className="bar-row__head">
          <span>CPU</span>
          <span className="bar-row__value">{CPU_PCT}%</span>
        </div>
        <ProgressBar pct={CPU_PCT} color={COLORS.blue} />
      </div>
      <div>
        <div className="bar-row__head">
          <span>Memory</span>
          <span className="bar-row__value">{RAM_LABEL}</span>
        </div>
        <ProgressBar pct={RAM_PCT} color={COLORS.blue} />
      </div>
    </Card>
  );
}
