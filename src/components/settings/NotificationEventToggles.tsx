import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { settingsApi } from '../../api/settingsApi';
import type { NotificationChannelToggle, NotificationEventDef, NotificationEventType, NotificationSeverity } from '../../types/settingsApi';
import { RoundCheckbox } from '../shared/RoundCheckbox';

const SEVERITY_ORDER: NotificationSeverity[] = ['high', 'medium', 'low'];
const SEVERITY_LABEL_KEYS: Record<NotificationSeverity, string> = {
  high: 'NotificationEventToggles.severityHigh',
  medium: 'NotificationEventToggles.severityMedium',
  low: 'NotificationEventToggles.severityLow',
};

interface NotificationEventTogglesProps {
  eventTypes: Record<NotificationEventType, NotificationChannelToggle>;
  onChange: (eventType: NotificationEventType, channel: keyof NotificationChannelToggle, enabled: boolean) => void;
  disabled?: boolean;
  // Slot for an event-specific subsection rendered below that event's own row - e.g. the CPU/disk
  // temperature thresholds under "Temperature alert". Keeps this component's own catalog-driven
  // genericness intact rather than hardcoding one event's UI here.
  renderExtra?: (eventId: NotificationEventType) => ReactNode;
}

/** Grouped High/Medium/Low toggle list for which array/storage-health events notify, and through
 *  which channel(s) - Apprise (external) and/or Webui (this app's own bell/toast). The catalog
 *  (labels, severities, defaults) is fetched from the backend so this never hand-duplicates that
 *  list and can't drift from what the server actually understands. */
export function NotificationEventToggles({ eventTypes, onChange, disabled, renderExtra }: NotificationEventTogglesProps) {
  const { t } = useTranslation('settings');
  const [events, setEvents] = useState<NotificationEventDef[] | null>(null);

  useEffect(() => {
    settingsApi.getNotificationEvents().then(setEvents).catch(() => {});
  }, []);

  if (!events) return <div className="status-note">{t('NotificationEventToggles.loading')}</div>;

  const channelsFor = (eventId: NotificationEventType): NotificationChannelToggle => {
    const defaults = events.find((e) => e.id === eventId)?.defaultEnabled ?? true;
    // webui defaults to true regardless of the catalog's apprise-oriented defaultEnabled - see
    // backend's DEFAULT_EVENT_TYPES doc comment for why (the in-app feed was always ungated
    // before this toggle existed).
    return { apprise: eventTypes[eventId]?.apprise ?? defaults, webui: eventTypes[eventId]?.webui ?? true };
  };

  const renderRow = (event: NotificationEventDef) => {
    const channels = channelsFor(event.id);
    return (
      <div key={event.id}>
        <div className="notification-event-row">
          <div className="toggle-row__title">{event.label}</div>
          <div className="notification-event-row__channels">
            <div className="notification-event-row__channel">
              <RoundCheckbox
                on={channels.apprise}
                onToggle={() => onChange(event.id, 'apprise', !channels.apprise)}
                label={t('NotificationEventToggles.appriseChannelLabel', { label: event.label })}
                disabled={disabled}
              />
            </div>
            <div className="notification-event-row__channel">
              <RoundCheckbox
                on={channels.webui}
                onToggle={() => onChange(event.id, 'webui', !channels.webui)}
                label={t('NotificationEventToggles.webuiChannelLabel', { label: event.label })}
                disabled={disabled}
              />
            </div>
          </div>
        </div>
        {renderExtra?.(event.id)}
      </div>
    );
  };

  return (
    <div>
      <div className="notification-channel-header">
        <div className="notification-channel-header__col">{t('NotificationEventToggles.apprise')}</div>
        <div className="notification-channel-header__col">{t('NotificationEventToggles.webui')}</div>
      </div>
      {SEVERITY_ORDER.map((severity) => {
        const group = events.filter((e) => e.severity === severity);
        if (group.length === 0) return null;
        return (
          <div key={severity} style={{ marginBottom: 12 }}>
            <div className="settings-info-row__label" style={{ marginBottom: 4 }}>
              {t(SEVERITY_LABEL_KEYS[severity])}
            </div>
            {segmentByGroup(group).map((segment, i) =>
              segment.group ? (
                <div key={`${severity}-${segment.group}-${i}`} className="toggle-group-box">
                  <div className="toggle-group-box__title">{segment.group}</div>
                  {segment.events.map(renderRow)}
                </div>
              ) : (
                segment.events.map(renderRow)
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Chunks a severity's events into runs of consecutive items sharing the same `group`, so those
 *  runs can render inside one bordered box instead of as flat, unrelated-looking rows. Items
 *  without a group (or a group that doesn't match their neighbor) get their own singleton run. */
function segmentByGroup(events: NotificationEventDef[]): { group?: string; events: NotificationEventDef[] }[] {
  const segments: { group?: string; events: NotificationEventDef[] }[] = [];
  for (const event of events) {
    const last = segments[segments.length - 1];
    if (event.group && last?.group === event.group) {
      last.events.push(event);
    } else {
      segments.push({ group: event.group, events: [event] });
    }
  }
  return segments;
}
