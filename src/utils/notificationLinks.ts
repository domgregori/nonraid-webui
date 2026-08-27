import type { NotificationEventType } from '../types/settingsApi';

// Where clicking a notification of this event type should take you - deliberately sparse (most
// event types have no single obvious destination), not a mapping every event needs to fill in.
export const NOTIFICATION_EVENT_LINKS: Partial<Record<NotificationEventType, string>> = {
  updateAvailable: '/settings#update',
};
