// Mirrors backend/src/activity/types.ts. Keep in sync.
import type { NotificationEventType } from './settingsApi';

export type ActivityColor = 'blue' | 'green' | 'amber' | 'red';

export interface ActivityEntry {
  id: string;
  timestamp: number; // unix ms
  text: string;
  color: ActivityColor;
  // Set only for entries tied to a notificationCatalog event - lets NotificationsProvider mute
  // the bell/toast for a specific event type via eventTypes[type].webui. History always shows
  // every entry regardless of this field - only the bell/toast layer filters on it.
  eventType?: NotificationEventType;
}
