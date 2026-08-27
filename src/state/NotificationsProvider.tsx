import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { activityApi } from '../api/activityApi';
import { settingsApi } from '../api/settingsApi';
import type { ActivityEntry } from '../types/activityApi';
import type { NotificationChannelToggle, NotificationEventType, NotificationSeverity } from '../types/settingsApi';
import { NotificationsContext, type ToastItem } from './NotificationsContext';

const POLL_MS = 8000;
const LIST_LIMIT = 30;
const TOAST_DURATION_MS = 7000;
const LAST_SEEN_KEY = 'nonraid.notifications.lastSeenId';

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [lastSeenId, setLastSeenId] = useState<string | null>(() => localStorage.getItem(LAST_SEEN_KEY));
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const mounted = useRef(true);
  // Ids already seen across polls, purely to detect what's *new* since the last poll - distinct
  // from lastSeenId, which tracks what the user has actually looked at (for the unread badge).
  // Always built from the *unfiltered* fetch (see refresh() below) so toggling an event's webui
  // setting later doesn't retroactively make an already-seen entry look "new" again.
  const knownIds = useRef<Set<string> | null>(null);
  const toastTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Latest known per-event webui preference - null until the first successful settings fetch, in
  // which case isWebuiMuted() below treats everything as unmuted (safer than hiding entries based
  // on nothing).
  const eventTypes = useRef<Record<NotificationEventType, NotificationChannelToggle> | null>(null);
  // Event catalog's own severity per event type ('high'|'medium'|'low', see
  // settings/notificationCatalog.ts) - static data, fetched once rather than on every poll. Used
  // to make the badge count only "high" severity unread entries instead of every unread entry.
  const eventSeverity = useRef<Partial<Record<NotificationEventType, NotificationSeverity>> | null>(null);

  useEffect(() => {
    settingsApi
      .getNotificationEvents()
      .then((defs) => {
        eventSeverity.current = Object.fromEntries(defs.map((d) => [d.id, d.severity]));
      })
      .catch(() => {});
  }, []);

  const isWebuiMuted = useCallback((entry: ActivityEntry): boolean => {
    return entry.eventType !== undefined && eventTypes.current?.[entry.eventType]?.webui === false;
  }, []);

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refresh = useCallback(async () => {
    let fresh: ActivityEntry[];
    try {
      fresh = await activityApi.list(LIST_LIMIT);
    } catch {
      return; // best-effort, same as every other poller in this app - keep last-known state
    }
    if (!mounted.current) return;

    // Best-effort and independent of the activity fetch above - a settings hiccup should never
    // block entries/toasts from updating, it just means filtering uses whatever eventTypes was
    // last successfully fetched (or none yet, which isWebuiMuted() treats as "nothing muted").
    settingsApi
      .getSettings()
      .then((s) => {
        if (mounted.current) eventTypes.current = s.notifications.eventTypes;
      })
      .catch(() => {});

    // Webui-muted entries never reach the bell dropdown/unread count - History (a separate
    // fetch, see ActivityHistoryDialog) stays the complete, unfiltered record regardless.
    setEntries(fresh.filter((e) => !isWebuiMuted(e)));

    if (knownIds.current === null) {
      // First poll after mount: seed silently. Without this, every backend restart (or just
      // opening the app) would toast the app's entire recent history at once - same "seed, don't
      // log" idiom ActivityWatcher itself uses for its own edge-triggered checks.
      knownIds.current = new Set(fresh.map((e) => e.id));
      return;
    }

    const newOnes = fresh.filter((e) => !knownIds.current!.has(e.id));
    knownIds.current = new Set(fresh.map((e) => e.id));
    if (newOnes.length === 0) return;

    // Toast only warnings/errors - routine blue/green completions still land in the bell
    // dropdown/history, just without interrupting whatever the user's doing. Webui-muted entries
    // never toast either.
    const toastWorthy = newOnes.filter((e) => (e.color === 'amber' || e.color === 'red') && !isWebuiMuted(e));
    if (toastWorthy.length === 0) return;

    setToasts((prev) => [...toastWorthy.map((entry) => ({ id: entry.id, entry })), ...prev]);
    for (const entry of toastWorthy) {
      const timer = setTimeout(() => dismissToast(entry.id), TOAST_DURATION_MS);
      toastTimers.current.set(entry.id, timer);
    }
  }, [dismissToast, isWebuiMuted]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
      for (const timer of toastTimers.current.values()) clearTimeout(timer);
      toastTimers.current.clear();
    };
  }, [refresh]);

  const markAllRead = useCallback(() => {
    const newest = entries[0]?.id ?? null;
    setLastSeenId(newest);
    if (newest) localStorage.setItem(LAST_SEEN_KEY, newest);
  }, [entries]);

  // Badge count is "high"/"medium" severity unread only (diskFailed, smartFailed, backupFailed,
  // tempAlertCpu, updateAvailable, ...) - "low" (parityStarted, arrayStarted, ...) is excluded so
  // routine activity doesn't inflate it. The dropdown itself still lists every unread entry
  // regardless of severity, this only changes what the number on the bell represents.
  const unreadCount = (() => {
    if (entries.length === 0) return 0;
    const cutoff =
      lastSeenId === null
        ? entries.length
        : (() => {
            const idx = entries.findIndex((e) => e.id === lastSeenId);
            // Not found means everything currently loaded is newer than the last-seen entry (it
            // aged out of this LIST_LIMIT-sized window) - treat the whole window as unread.
            return idx === -1 ? entries.length : idx;
          })();
    return entries.slice(0, cutoff).filter((e) => {
      const severity = e.eventType !== undefined ? eventSeverity.current?.[e.eventType] : undefined;
      return severity === 'high' || severity === 'medium';
    }).length;
  })();

  return (
    <NotificationsContext.Provider value={{ entries, unreadCount, toasts, markAllRead, dismissToast }}>
      {children}
    </NotificationsContext.Provider>
  );
}
