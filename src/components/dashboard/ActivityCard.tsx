import { deriveActivityLog } from '../../selectors/activity';
import { Card } from '../shared/Card';

export function ActivityCard() {
  const entries = deriveActivityLog();

  return (
    <Card>
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        Activity
      </div>
      <div className="activity-list">
        {entries.map((entry, i) => (
          <div className="activity-item" key={i}>
            <div className="activity-dot" style={{ background: entry.color }} />
            <div style={{ minWidth: 0 }}>
              <div className="activity-text">{entry.text}</div>
              <div className="activity-time">{entry.time}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
