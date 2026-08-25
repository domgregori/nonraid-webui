import { createContext } from 'react';
import type { ActivityEntry } from '../types/activityApi';

export interface ToastItem {
  id: string;
  entry: ActivityEntry;
}

export interface NotificationsContextValue {
  /** Most recent entries (newest-first) - same feed the bell dropdown, ArrayErrorCard's history,
   *  and the old Dashboard Activity card all ultimately read from. */
  entries: ActivityEntry[];
  /** Unread count restricted to "high"/"medium" severity events (see notificationCatalog.ts) -
   *  what the bell badge shows. `entries` itself is unfiltered; this only changes the number. */
  unreadCount: number;
  toasts: ToastItem[];
  /** Called when the bell dropdown opens - marks every currently-loaded entry as seen. */
  markAllRead: () => void;
  dismissToast: (id: string) => void;
}

export const NotificationsContext = createContext<NotificationsContextValue | null>(null);
