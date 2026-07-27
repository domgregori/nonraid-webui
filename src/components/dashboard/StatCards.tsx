import { COLORS } from '../../styles/colors';
import { deriveCapacity, deriveDisks, deriveDisksOnline } from '../../selectors/disks';
import { deriveProtection } from '../../selectors/status';
import { useAppStore } from '../../state/useAppStore';
import { Card } from '../shared/Card';
import { ProgressBar } from '../shared/ProgressBar';

export function StatCards() {
  const { state } = useAppStore();
  const { parity, data } = deriveDisks(state);
  const capacity = deriveCapacity(data, state.arrayStarted);
  const protection = deriveProtection(state.scenario, state.arrayStarted);
  const disksOnline = deriveDisksOnline([...parity, ...data]);

  return (
    <div className="stat-row">
      <Card className="stat-card">
        <div className="eyebrow">Capacity</div>
        <div className="stat-value">
          {capacity.usedTB} <span className="stat-value__unit">/ {capacity.totalTB} TB</span>
        </div>
        <ProgressBar pct={capacity.pct} color={COLORS.blue} />
        <div className="stat-card__footnote">{capacity.freeTB} TB free</div>
      </Card>

      <Card className="stat-card">
        <div className="eyebrow">Protection</div>
        <div className="protection-row">
          <span className="protection-dot" style={{ background: protection.color }} />
          <span className="protection-label">{protection.short}</span>
        </div>
        <div className="protection-text">{protection.text}</div>
      </Card>

      <Card className="stat-card">
        <div className="eyebrow">Disks</div>
        <div className="stat-value">
          {disksOnline} <span className="stat-value__unit">/ 12 online</span>
        </div>
        <div className="stat-card__footnote">2 parity · 10 data</div>
      </Card>
    </div>
  );
}
