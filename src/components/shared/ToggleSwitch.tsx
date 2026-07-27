import { COLORS } from '../../styles/colors';

interface ToggleSwitchProps {
  on: boolean;
  onToggle: () => void;
  label: string;
}

export function ToggleSwitch({ on, onToggle, label }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      className="toggle-switch"
      aria-pressed={on}
      aria-label={label}
      onClick={onToggle}
      style={{ background: on ? COLORS.blue : COLORS.border }}
    >
      <div className="toggle-switch__thumb" style={{ marginLeft: on ? 18 : 0 }} />
    </button>
  );
}
