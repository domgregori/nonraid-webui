import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { activityApi } from '../api/activityApi';
import type { ActivityEntry } from '../types/activityApi';
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
  const knownIds = useRef<Set<string> | null>(null);
  const toastTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

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
    setEntries(fresh);

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
    // dropdown/history, just without interrupting whatever the user's doing.
    const toastWorthy = newOnes.filter((e) => e.color === 'amber' || e.color === 'red');
    if (toastWorthy.length === 0) return;

    setToasts((prev) => [...toastWorthy.map((entry) => ({ id: entry.id, entry })), ...prev]);
    for (const entry of toastWorthy) {
      const timer = setTimeout(() => dismissToast(entry.id), TOAST_DURATION_MS);
      toastTimers.current.set(entry.id, timer);
    }
  }, [dismissToast]);

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

  const unreadCount = (() => {
    if (entries.length === 0) return 0;
    if (lastSeenId === null) return entries.length;
    const idx = entries.findIndex((e) => e.id === lastSeenId);
    // Not found means everything currently loaded is newer than the last-seen entry (it aged out
    // of this LIST_LIMIT-sized window) - treat the whole visible window as unread rather than 0.
    return idx === -1 ? entries.length : idx;
  })();

  return (
    <NotificationsContext.Provider value={{ entries, unreadCount, toasts, markAllRead, dismissToast }}>
      {children}
    </NotificationsContext.Provider>
  );
}
