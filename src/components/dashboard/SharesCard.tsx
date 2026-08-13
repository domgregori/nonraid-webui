import { Link } from 'react-router-dom';
import { useShares } from '../../hooks/useShares';
import { deriveShareViewModel } from '../../selectors/shares';
import { Card } from '../shared/Card';

export function SharesCard() {
  const { shares } = useShares();
  const views = shares.map(deriveShareViewModel);

  return (
    <Card>
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        Pools
      </div>

      {views.length === 0 ? (
        <div className="status-note">No pools yet.</div>
      ) : (
        views.map((share, i) => (
          <div key={share.name} className={`share-summary-row${i > 0 ? ' share-summary-row--bordered' : ''}`}>
            <div className="share-summary-row__head">
              <span className="toggle-row__title">{share.name}</span>
              <span className="toggle-row__desc">{share.protocolLabel}</span>
            </div>
            {share.description && <div className="toggle-row__desc">{share.description}</div>}
            <div className="toggle-row__desc">
              {share.connectionsLabel} &middot; {share.accessLabel}
            </div>
          </div>
        ))
      )}

      <Link to="/shares" className="share-summary-manage-link">
        Manage pools &rarr;
      </Link>
    </Card>
  );
}
