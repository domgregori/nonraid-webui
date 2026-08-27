import { describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_TYPES, NOTIFICATION_EVENTS, type NotificationEventType } from './notificationCatalog.js';

describe('NOTIFICATION_EVENTS', () => {
  it('has no duplicate event ids', () => {
    const ids = NOTIFICATION_EVENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // These three were added this session; pinned explicitly so a future edit that drops one
  // (or silently changes its severity/default) fails loudly instead of just shrinking the list.
  it.each([
    ['backupSkipped', 'high', true],
    ['dockerLxcStorageUnavailable', 'high', true],
    ['remoteBackupRetentionFailed', 'medium', true],
  ] as const)('includes %s with severity %s and defaultEnabled %s', (id, severity, defaultEnabled) => {
    const event = NOTIFICATION_EVENTS.find((e) => e.id === id);
    expect(event).toBeDefined();
    expect(event?.severity).toBe(severity);
    expect(event?.defaultEnabled).toBe(defaultEnabled);
  });
});

describe('DEFAULT_EVENT_TYPES', () => {
  // DEFAULT_EVENT_TYPES is built with `as Record<NotificationEventType, ...>` - a cast, not a
  // structural check, so if NOTIFICATION_EVENTS ever drifts out of sync with the NotificationEventType
  // union (an id added to one but not the other) TypeScript won't catch it. This is the runtime
  // safety net: every catalog entry must produce a real DEFAULT_EVENT_TYPES entry.
  it('has exactly one entry per NOTIFICATION_EVENTS id, with none missing or extra', () => {
    const catalogIds = NOTIFICATION_EVENTS.map((e) => e.id).sort();
    const defaultIds = (Object.keys(DEFAULT_EVENT_TYPES) as NotificationEventType[]).sort();
    expect(defaultIds).toEqual(catalogIds);
  });

  it.each(NOTIFICATION_EVENTS)('derives $id\'s toggle from its catalog defaultEnabled, with webui always on', (event) => {
    expect(DEFAULT_EVENT_TYPES[event.id]).toEqual({ apprise: event.defaultEnabled, webui: true });
  });
});
