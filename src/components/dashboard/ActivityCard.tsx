import { useState } from 'react';
import { useActivity } from '../../hooks/useActivity';
import { COLORS } from '../../styles/colors';
import { formatRelativeTime } from '../../utils/format';
import { ActivityHistoryDialog } from '../activity/ActivityHistoryDialog';
import { Card } from '../shared/Card';

const CARD_LIMIT = 5;
const POLL_MS = 8000;

export function ActivityCard() {
  const { entries, loading, error } = useActivity(CARD_LIMIT, POLL_MS);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <Card>
      <div className="activity-card__head">
        <div className="eyebrow">Activity</div>
        <button type="button" className="activity-card__view-all" onClick={() => setHistoryOpen(true)}>
          View all
        </button>
      </div>

      {loading && entries.length === 0 && <div className="status-note">Loading…</div>}
      {error && entries.length === 0 && <div className="status-note status-note--error">{error}</div>}
      {!loading && !error && entries.length === 0 && <div className="status-note">Nothing yet.</div>}

      <div className="activity-list">
        {entries.map((entry) => (
          <div className="activity-item" key={entry.id}>
            <div className="activity-dot" style={{ background: COLORS[entry.color] }} />
            <div style={{ minWidth: 0 }}>
              <div className="activity-text">{entry.text}</div>
              <div className="activity-time">{formatRelativeTime(entry.timestamp)}</div>
            </div>
          </div>
        ))}
      </div>

      {historyOpen && <ActivityHistoryDialog onClose={() => setHistoryOpen(false)} />}
    </Card>
  );
}
