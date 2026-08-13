import { useEffect, useRef, useState } from 'react';
import { useNotifications } from '../../state/useNotifications';
import { COLORS } from '../../styles/colors';
import { formatRelativeTime } from '../../utils/format';
import { ActivityHistoryDialog } from '../activity/ActivityHistoryDialog';

const DROPDOWN_LIMIT = 10;

/**
 * Bell icon in the header — the one place "things worth knowing about" now lives, replacing the
 * old Dashboard-only Activity card. Reuses the same feed (useNotifications, backed by
 * activity.json) and the same row markup the old card used, plus ActivityHistoryDialog unchanged
 * for "View all" (still the best full-history view: limit picker, refresh, scroll).
 */
export function NotificationBell() {
  const { entries, unreadCount, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const handleToggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) markAllRead();
      return next;
    });
  };

  const recent = entries.slice(0, DROPDOWN_LIMIT);

  return (
    <div className="notification-bell" ref={rootRef}>
      <button type="button" className="notification-bell__button" onClick={handleToggle} aria-label="Notifications">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && <span className="notification-bell__badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="notification-dropdown">
          {recent.length === 0 && <div className="status-note">Nothing yet.</div>}
          {recent.length > 0 && (
            <div className="activity-list">
              {recent.map((entry) => (
                <div className="activity-item" key={entry.id}>
                  <div className="activity-dot" style={{ background: COLORS[entry.color] }} />
                  <div style={{ minWidth: 0 }}>
                    <div className="activity-text">{entry.text}</div>
                    <div className="activity-time">{formatRelativeTime(entry.timestamp)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            className="notification-dropdown__view-all"
            onClick={() => {
              setOpen(false);
              setHistoryOpen(true);
            }}
          >
            View all
          </button>
        </div>
      )}

      {historyOpen && <ActivityHistoryDialog onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}
