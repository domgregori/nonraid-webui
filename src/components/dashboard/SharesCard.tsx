import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useShares } from '../../hooks/useShares';
import { deriveShareViewModel } from '../../selectors/shares';
import { Card } from '../shared/Card';

export function SharesCard() {
  const { t } = useTranslation('dashboard');
  const { shares } = useShares();
  const views = shares.map(deriveShareViewModel);

  return (
    <Card>
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        {t('SharesCard.pools')}
      </div>

      {views.length === 0 ? (
        <div className="status-note">{t('SharesCard.noPools')}</div>
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
        {t('SharesCard.managePools')} &rarr;
      </Link>
    </Card>
  );
}
