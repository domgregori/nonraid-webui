import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useActivity } from '../../hooks/useActivity';
import { COLORS } from '../../styles/colors';
import { formatRelativeTime } from '../../utils/format';
import { NOTIFICATION_EVENT_LINKS } from '../../utils/notificationLinks';

interface ActivityHistoryDialogProps {
  onClose: () => void;
}

const LIMIT_OPTIONS = [20, 50, 100, 200];

export function ActivityHistoryDialog({ onClose }: ActivityHistoryDialogProps) {
  const [limit, setLimit] = useState(50);
  const { entries, loading, error, refresh } = useActivity(limit);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [entries]);

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog activity-history-dialog">
        <div className="dialog__head">
          <div className="dialog__title">Activity History</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          <div className="docker-logs-toolbar">
            <select className="history-input" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {LIMIT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  Last {n} events
                </option>
              ))}
            </select>
            <button type="button" className="btn" disabled={loading} onClick={refresh}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          {error && <div className="status-note status-note--error">{error}</div>}
          {!loading && !error && entries.length === 0 && <div className="status-note">Nothing yet.</div>}

          {entries.length > 0 && (
            <div className="activity-list activity-list--dialog" ref={listRef}>
              {entries.map((entry) => {
                const link = entry.eventType ? NOTIFICATION_EVENT_LINKS[entry.eventType] : undefined;
                const row = (
                  <>
                    <div className="activity-dot" style={{ background: COLORS[entry.color] }} />
                    <div style={{ minWidth: 0 }}>
                      <div className="activity-text">{entry.text}</div>
                      <div className="activity-time">{formatRelativeTime(entry.timestamp)}</div>
                    </div>
                  </>
                );
                return link ? (
                  <Link to={link} className="activity-item activity-item--link" key={entry.id} onClick={onClose}>
                    {row}
                  </Link>
                ) : (
                  <div className="activity-item" key={entry.id}>
                    {row}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
