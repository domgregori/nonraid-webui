import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoundCheckbox } from './RoundCheckbox';

describe('RoundCheckbox', () => {
  it('renders an unchecked checkbox with the label as its accessible name', () => {
    render(<RoundCheckbox on={false} onToggle={() => {}} label="Notifications" />);
    const checkbox = screen.getByRole('checkbox', { name: 'Notifications' });
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toHaveClass('round-checkbox');
  });

  it('renders checked when on is true', () => {
    render(<RoundCheckbox on onToggle={() => {}} label="Notifications" />);
    expect(screen.getByRole('checkbox', { name: 'Notifications' })).toBeChecked();
  });

  it('fires onToggle when toggled', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<RoundCheckbox on={false} onToggle={onToggle} label="Notifications" />);
    await user.click(screen.getByRole('checkbox', { name: 'Notifications' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('is disabled and does not fire onToggle when disabled', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<RoundCheckbox on={false} onToggle={onToggle} label="Notifications" disabled />);
    const checkbox = screen.getByRole('checkbox', { name: 'Notifications' });
    expect(checkbox).toBeDisabled();
    await user.click(checkbox);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
