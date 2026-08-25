export type NotificationEventType =
  | 'diskFailed'
  | 'diskErrors'
  | 'smartFailed'
  | 'parityErrors'
  | 'backupFailed'
  | 'tempAlertCpu'
  | 'tempAlertDisk'
  | 'diskAdded'
  | 'arrayReconfigured'
  | 'parityStarted'
  | 'parityCompleted'
  | 'backupCompleted'
  | 'arrayStarted'
  | 'arrayStopped'
  | 'cacheMirrorDegraded'
  | 'cacheMoverFailed'
  | 'cacheMoverCompleted'
  | 'arrayError'
  | 'diskNeedsFormat'
  | 'updateAvailable'
  | 'dockerUpdateAvailable';

export type NotificationSeverity = 'high' | 'medium' | 'low';

export interface NotificationEventDef {
  id: NotificationEventType;
  label: string;
  severity: NotificationSeverity;
  defaultEnabled: boolean;
  // Consecutive events sharing the same group render together inside one bordered box in the
  // frontend's toggle list, instead of as flat, unrelated-looking rows - e.g. CPU/Disk temperature.
  group?: string;
}

// Two independent channels per event: apprise gates notifyEvent()'s external send (notify.ts),
// webui gates whether the in-app bell/toast system surfaces it (NotificationsProvider.tsx) -
// History (ActivityHistoryDialog) is never gated by either, it's always the complete record.
export interface NotificationChannelToggle {
  apprise: boolean;
  webui: boolean;
}

/**
 * Single source of truth for which array/storage-health events can trigger a notification, their
 * severity grouping, and default on/off state. Scoped deliberately to passive health events, not
 * management actions (Docker/LXC/share/user changes) - an admin already sees those the moment they
 * perform them. Both the settings defaults and the frontend's grouped toggle UI read from this same
 * list (via GET /settings/notification-events) so they can't drift apart.
 */
export const NOTIFICATION_EVENTS: NotificationEventDef[] = [
  { id: 'arrayError', label: 'Array in an error state', severity: 'high', defaultEnabled: true },
  { id: 'diskFailed', label: 'Disk failed or went offline', severity: 'high', defaultEnabled: true },
  { id: 'diskErrors', label: 'Disk reported new errors', severity: 'high', defaultEnabled: true },
  { id: 'smartFailed', label: 'SMART health check failed', severity: 'high', defaultEnabled: true },
  { id: 'parityErrors', label: 'Parity check finished with errors', severity: 'high', defaultEnabled: true },
  { id: 'backupFailed', label: 'Scheduled backup failed', severity: 'high', defaultEnabled: true },
  { id: 'cacheMirrorDegraded', label: 'Cache mirror degraded', severity: 'high', defaultEnabled: true },
  { id: 'cacheMoverFailed', label: 'Cache mover failed', severity: 'high', defaultEnabled: true },
  { id: 'tempAlertCpu', label: 'CPU temperature alert', severity: 'medium', defaultEnabled: true, group: 'Temperature' },
  { id: 'tempAlertDisk', label: 'Disk temperature alert', severity: 'medium', defaultEnabled: true, group: 'Temperature' },
  { id: 'diskAdded', label: 'Disk added or replaced', severity: 'medium', defaultEnabled: true },
  { id: 'arrayReconfigured', label: 'Array reconfigured (disk dropped)', severity: 'medium', defaultEnabled: true },
  { id: 'diskNeedsFormat', label: 'Disk needs formatting', severity: 'medium', defaultEnabled: true },
  { id: 'updateAvailable', label: 'Software update available', severity: 'medium', defaultEnabled: true },
  { id: 'dockerUpdateAvailable', label: 'Docker container update available', severity: 'medium', defaultEnabled: true },
  { id: 'parityStarted', label: 'Parity check started', severity: 'low', defaultEnabled: false },
  { id: 'parityCompleted', label: 'Parity check finished with no errors', severity: 'low', defaultEnabled: false },
  { id: 'backupCompleted', label: 'Scheduled backup completed', severity: 'low', defaultEnabled: false },
  { id: 'arrayStarted', label: 'Array started', severity: 'low', defaultEnabled: false },
  { id: 'arrayStopped', label: 'Array stopped', severity: 'low', defaultEnabled: false },
  { id: 'cacheMoverCompleted', label: 'Cache mover completed', severity: 'low', defaultEnabled: false },
];

// webui defaults to true for every event regardless of defaultEnabled - the in-app activity feed
// this fed into (activity.log()) was always unconditional/ungated before this toggle existed, so
// defaulting webui off here would silently mute toasts/bell entries users are already used to
// seeing. apprise keeps using the catalog's own defaultEnabled, unchanged from before this split.
export const DEFAULT_EVENT_TYPES: Record<NotificationEventType, NotificationChannelToggle> = Object.fromEntries(
  NOTIFICATION_EVENTS.map((e) => [e.id, { apprise: e.defaultEnabled, webui: true }]),
) as Record<NotificationEventType, NotificationChannelToggle>;
