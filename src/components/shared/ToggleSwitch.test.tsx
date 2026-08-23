import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToggleSwitch } from './ToggleSwitch';
import { COLORS } from '../../styles/colors';

describe('ToggleSwitch', () => {
  it('renders an off switch whose accessible name is the label', () => {
    render(<ToggleSwitch on={false} onToggle={() => {}} label="Use all drives" />);
    const button = screen.getByRole('button', { name: 'Use all drives' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).not.toBeDisabled();
  });

  it('reflects the on state in aria-pressed, background color, and thumb position', () => {
    render(<ToggleSwitch on onToggle={() => {}} label="Use all drives" />);
    const button = screen.getByRole('button', { name: 'Use all drives' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveStyle({ background: COLORS.blue });
    const thumb = button.querySelector('.toggle-switch__thumb');
    expect(thumb).toHaveStyle({ marginLeft: '18px' });
  });

  it('calls onToggle when clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<ToggleSwitch on={false} onToggle={onToggle} label="Use all drives" />);
    await user.click(screen.getByRole('button', { name: 'Use all drives' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('is disabled and ignores clicks when disabled is true', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<ToggleSwitch on={false} onToggle={onToggle} label="Use all drives" disabled />);
    const button = screen.getByRole('button', { name: 'Use all drives' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
