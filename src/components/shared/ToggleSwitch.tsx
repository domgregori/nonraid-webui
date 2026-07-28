import { COLORS } from '../../styles/colors';

interface ToggleSwitchProps {
  on: boolean;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
}

export function ToggleSwitch({ on, onToggle, label, disabled }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      className="toggle-switch"
      aria-pressed={on}
      aria-label={label}
      onClick={onToggle}
      disabled={disabled}
      style={{ background: on ? COLORS.blue : COLORS.border, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer' }}
    >
      <div className="toggle-switch__thumb" style={{ marginLeft: on ? 18 : 0 }} />
    </button>
  );
}
