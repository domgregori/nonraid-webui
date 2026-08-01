import { useSettings } from '../../hooks/useSettings';
import { Card } from '../shared/Card';
import { ToggleSwitch } from '../shared/ToggleSwitch';

export function SettingsQuickCard() {
  const { settings, saving, update } = useSettings();

  return (
    <Card>
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        Settings
      </div>

      <div className="toggle-row">
        <div>
          <div className="toggle-row__title">Turbo write</div>
          <div className="toggle-row__desc">Reconstruct write mode</div>
        </div>
        <ToggleSwitch
          on={settings?.turboWrite ?? false}
          onToggle={() => settings && update({ turboWrite: !settings.turboWrite })}
          label="Turbo write"
          disabled={!settings || saving}
        />
      </div>

      <div className="toggle-row toggle-row--bordered">
        <div>
          <div className="toggle-row__title">Event notifications</div>
          <div className="toggle-row__desc">Dispatch via apprise</div>
        </div>
        <ToggleSwitch
          on={settings?.notifications.enabled ?? false}
          onToggle={() => settings && update({ notifications: { enabled: !settings.notifications.enabled } })}
          label="Event notifications"
          disabled={!settings || saving}
        />
      </div>
    </Card>
  );
}
