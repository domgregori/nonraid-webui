import { COLORS } from '../styles/colors';
import { SHARES } from '../mock/shares';
import { deriveShareViewModel } from '../selectors/shares';
import { ProgressBar } from '../components/shared/ProgressBar';

export function SharesPage() {
  const shares = SHARES.map(deriveShareViewModel);

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">Shares</div>
        <button type="button" className="btn--primary">
          Add Share
        </button>
      </div>

      <div className="list">
        {shares.map((share) => (
          <div className="list-card" key={share.name}>
            <div className="list-card__col--name">
              <div className="list-card__title">{share.name}</div>
              <div className="list-card__subtitle">{share.protocol}</div>
            </div>
            <div className="list-card__col">
              <div>Allocation: {share.allocMethod}</div>
              <div style={{ marginTop: 2 }}>Disks: {share.disks}</div>
            </div>
            <div className="list-card__progress">
              <ProgressBar pct={share.pct} color={COLORS.blue} />
              <div className="list-card__progress-label">
                {share.usedTB} / {share.sizeTB} TB
              </div>
            </div>
            <div className="list-card__actions">
              <button type="button" className="btn">
                Edit
              </button>
              <button type="button" className="btn btn--danger">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
