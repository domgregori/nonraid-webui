import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StatusDot } from './StatusDot';

describe('StatusDot', () => {
  it('renders a dot with the given color and the default size of 7px', () => {
    const { container } = render(<StatusDot color="var(--color-green)" />);
    const dot = container.firstChild as HTMLElement;
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveStyle({ background: 'var(--color-green)', width: '7px', height: '7px' });
  });

  it('applies a custom size and className', () => {
    const { container } = render(<StatusDot color="var(--color-red)" size={12} className="status-dot" />);
    const dot = container.firstChild as HTMLElement;
    expect(dot).toHaveClass('status-dot');
    expect(dot).toHaveStyle({ width: '12px', height: '12px', background: 'var(--color-red)' });
  });
});
