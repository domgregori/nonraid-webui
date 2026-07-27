import { useAppStore } from '../state/useAppStore';
import { ToggleSwitch } from '../components/shared/ToggleSwitch';

export function SettingsPage() {
  const { state, dispatch } = useAppStore();

  return (
    <div className="page page--narrow">
      <div className="page-title">Settings</div>

      <div className="settings-card">
        <div className="settings-card__title">Array</div>
        <div className="toggle-row">
          <div>
            <div className="toggle-row__title">Turbo write</div>
            <div className="toggle-row__desc">Reconstruct write mode — faster writes, keeps all disks spinning</div>
          </div>
          <ToggleSwitch
            on={state.settings.turboWrite}
            onToggle={() => dispatch({ type: 'TOGGLE_TURBO' })}
            label="Turbo write"
          />
        </div>
        <div className="toggle-row toggle-row--bordered">
          <div>
            <div className="toggle-row__title">Superblock path</div>
            <div className="toggle-row__desc toggle-row__desc--mono">/nonraid.dat</div>
          </div>
        </div>
        <div className="toggle-row toggle-row--bordered">
          <div>
            <div className="toggle-row__title">Parity check schedule</div>
            <div className="toggle-row__desc">Quarterly, check-only mode</div>
          </div>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card__title">Notifications</div>
        <div className="toggle-row">
          <div>
            <div className="toggle-row__title">Event notifications</div>
            <div className="toggle-row__desc">Alert on array health changes</div>
          </div>
          <ToggleSwitch
            on={state.settings.notifyEnabled}
            onToggle={() => dispatch({ type: 'TOGGLE_NOTIFY' })}
            label="Event notifications"
          />
        </div>
        <div className="toggle-row toggle-row--bordered">
          <div>
            <div className="toggle-row__title">Notify command</div>
            <div className="toggle-row__desc toggle-row__desc--mono">apprise -t "NonRAID" -b</div>
          </div>
        </div>
      </div>

      <div className="danger-card">
        <div className="danger-card__title">Danger Zone</div>
        <div className="danger-card__text">
          New Config resets the array topology, letting you add or remove disks without a full rebuild. Existing disk
          data is preserved but parity will need to be rebuilt.
        </div>
        <button type="button" className="btn btn--danger">
          Start New Config
        </button>
      </div>
    </div>
  );
}
