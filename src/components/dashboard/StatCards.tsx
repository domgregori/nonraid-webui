import { COLORS } from '../../styles/colors';
import { deriveCapacity, deriveDisks, deriveDisksOnline } from '../../selectors/disks';
import { deriveProtection } from '../../selectors/status';
import { useArrayStatus } from '../../state/useArrayStatus';
import { Card } from '../shared/Card';
import { ProgressBar } from '../shared/ProgressBar';

export function StatCards() {
  const { status, temps } = useArrayStatus();
  if (!status) return null;

  const { parity, data } = deriveDisks(status, temps);
  const arrayStarted = status.array.state === 'STARTED';
  const capacity = deriveCapacity(data, arrayStarted);
  const protection = deriveProtection(status);
  const disksOnline = deriveDisksOnline([...parity, ...data]);

  return (
    <div className="stat-row">
      <Card className="stat-card">
        <div className="eyebrow">Capacity</div>
        <div className="stat-value">
          {capacity.usedLabel} <span className="stat-value__unit">/ {capacity.totalLabel}</span>
        </div>
        <ProgressBar pct={capacity.pct} color={COLORS.blue} />
        <div className="stat-card__footnote">{capacity.freeLabel} free</div>
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
          {disksOnline} <span className="stat-value__unit">/ {status.array.disks_present} online</span>
        </div>
        <div className="stat-card__footnote">
          {parity.length} parity · {data.length} data
        </div>
      </Card>
    </div>
  );
}
