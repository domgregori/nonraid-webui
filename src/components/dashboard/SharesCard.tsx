import { Link } from 'react-router-dom';
import { useShares } from '../../hooks/useShares';
import { formatBytesHuman } from '../../utils/format';
import { Card } from '../shared/Card';

export function SharesCard() {
  const { shares } = useShares();
  const usedBytes = shares.reduce((sum, s) => sum + (s.stats.usedBytes ?? 0), 0);

  return (
    <Card>
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        Shares
      </div>

      <Link to="/shares" className="service-row">
        <div>
          <div className="toggle-row__title">
            {shares.length} share{shares.length === 1 ? '' : 's'}
          </div>
          <div className="toggle-row__desc">Manage shares &rarr;</div>
        </div>
        <span className="bar-row__value">{usedBytes > 0 ? formatBytesHuman(usedBytes) : '—'}</span>
      </Link>
    </Card>
  );
}
