import { useEffect, useState, type ReactNode } from 'react';
import { settingsApi } from '../../api/settingsApi';
import type { NotificationEventDef, NotificationEventType, NotificationSeverity } from '../../types/settingsApi';
import { ToggleSwitch } from '../shared/ToggleSwitch';

const SEVERITY_ORDER: NotificationSeverity[] = ['high', 'medium', 'low'];
const SEVERITY_LABELS: Record<NotificationSeverity, string> = { high: 'High', medium: 'Medium', low: 'Low' };

interface NotificationEventTogglesProps {
  eventTypes: Record<NotificationEventType, boolean>;
  onChange: (eventType: NotificationEventType, enabled: boolean) => void;
  disabled?: boolean;
  // Slot for event-specific extra controls rendered inline in that event's own row (between the
  // label and the toggle) — e.g. the temperature threshold next to "Temperature alert". Keeps this
  // component's own catalog-driven genericness intact rather than hardcoding one event's UI here.
  renderExtra?: (eventId: NotificationEventType) => ReactNode;
}

/** Grouped High/Medium/Low toggle list for which array/storage-health events trigger a
 *  notification — the catalog (labels, severities, defaults) is fetched from the backend so this
 *  never hand-duplicates that list and can't drift from what the server actually understands. */
export function NotificationEventToggles({ eventTypes, onChange, disabled, renderExtra }: NotificationEventTogglesProps) {
  const [events, setEvents] = useState<NotificationEventDef[] | null>(null);

  useEffect(() => {
    settingsApi.getNotificationEvents().then(setEvents).catch(() => {});
  }, []);

  if (!events) return <div className="status-note">Loading event types…</div>;

  return (
    <div>
      {SEVERITY_ORDER.map((severity) => {
        const group = events.filter((e) => e.severity === severity);
        if (group.length === 0) return null;
        return (
          <div key={severity} style={{ marginBottom: 12 }}>
            <div className="settings-info-row__label" style={{ marginBottom: 4 }}>
              {SEVERITY_LABELS[severity]}
            </div>
            {group.map((event) => (
              <div key={event.id} className="toggle-row" style={{ padding: '6px 0' }}>
                <div className="toggle-row__title">{event.label}</div>
                {renderExtra?.(event.id)}
                <ToggleSwitch
                  on={eventTypes[event.id] ?? event.defaultEnabled}
                  onToggle={() => onChange(event.id, !(eventTypes[event.id] ?? event.defaultEnabled))}
                  label={event.label}
                  disabled={disabled}
                />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
