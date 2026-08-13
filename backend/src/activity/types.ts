import type { NotificationEventType } from '../settings/notificationCatalog.js';

// Maps to the same four tokens the rest of the UI already uses for status
// dots/badges (src/styles/colors.ts's COLORS) - green/blue for routine
// completions, amber for pauses/warnings, red for deletions/failures.
export type ActivityColor = 'blue' | 'green' | 'amber' | 'red';

export interface ActivityEntry {
  id: string;
  timestamp: number; // unix ms
  text: string;
  color: ActivityColor;
  // Set only for entries that correspond to a notificationCatalog event (i.e. logged alongside a
  // notifyEvent() call) - lets NotificationsProvider.tsx mute the bell/toast for a specific event
  // type via eventTypes[type].webui, without ever filtering the full History view (which reads
  // straight from this store, unfiltered, regardless of this field).
  eventType?: NotificationEventType;
}
