interface RoundCheckboxProps {
  on: boolean;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
}

/** Small circular checkbox - mirrors ToggleSwitch's prop shape (on/onToggle/label/disabled) for a
 *  drop-in feel, but renders as a real checkbox rather than a pill, for contexts needing two
 *  independent per-row controls side by side (see NotificationEventToggles). */
export function RoundCheckbox({ on, onToggle, label, disabled }: RoundCheckboxProps) {
  return <input type="checkbox" className="round-checkbox" checked={on} onChange={onToggle} aria-label={label} disabled={disabled} />;
}
