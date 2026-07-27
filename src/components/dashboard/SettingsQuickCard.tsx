import { useAppStore } from '../../state/useAppStore';
import { Card } from '../shared/Card';
import { ToggleSwitch } from '../shared/ToggleSwitch';

export function SettingsQuickCard() {
  const { state, dispatch } = useAppStore();

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
        <ToggleSwitch on={state.settings.turboWrite} onToggle={() => dispatch({ type: 'TOGGLE_TURBO' })} label="Turbo write" />
      </div>

      <div className="toggle-row toggle-row--bordered">
        <div>
          <div className="toggle-row__title">Event notifications</div>
          <div className="toggle-row__desc">Array health alerts</div>
        </div>
        <ToggleSwitch on={state.settings.notifyEnabled} onToggle={() => dispatch({ type: 'TOGGLE_NOTIFY' })} label="Event notifications" />
      </div>
    </Card>
  );
}
