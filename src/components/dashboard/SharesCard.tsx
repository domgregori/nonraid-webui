import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useShares } from '../../hooks/useShares';
import { deriveShareViewModel, isShareReachable } from '../../selectors/shares';
import { Card } from '../shared/Card';

export function SharesCard() {
  const { t } = useTranslation('dashboard');
  const { shares } = useShares();
  // A share nobody can actually connect to doesn't belong here - either no protocol is enabled at
  // all (a pool that exists purely as array-backed storage for something else, e.g. a Docker/LXC
  // bind mount), or SMB is enabled but has neither `public` nor any real user/group grant, which is
  // just as unreachable in practice (no valid Samba credentials exist for it). The dashboard card
  // is for shares people actually reach over the network, so neither case belongs here - both stay
  // fully visible and manageable on the Shares page itself.
  const views = shares.filter(isShareReachable).map(deriveShareViewModel);

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
