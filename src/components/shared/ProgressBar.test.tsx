import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('renders a fill at the given percentage with the given color', () => {
    const { container } = render(<ProgressBar pct={50} color="var(--color-blue)" />);
    const track = container.querySelector('.progress-track');
    expect(track).toBeInTheDocument();
    const fill = container.querySelector('.progress-track__fill');
    expect(fill).toBeInTheDocument();
    expect(fill).toHaveStyle({ width: '50%' });
    expect(fill).toHaveStyle({ background: 'var(--color-blue)' });
  });

  it('defaults to 0% when pct is omitted', () => {
    const { container } = render(<ProgressBar color="var(--color-blue)" />);
    expect(container.querySelector('.progress-track__fill')).toHaveStyle({ width: '0%' });
  });

  it('renders the indeterminate sweep mode instead of a percentage fill', () => {
    const { container } = render(<ProgressBar color="var(--color-blue)" indeterminate />);
    const fill = container.querySelector('.progress-track__fill');
    expect(fill).toHaveClass('progress-track__fill--indeterminate');
    expect(fill).not.toHaveStyle({ width: '50%' });
    expect(fill).toHaveStyle({ background: 'var(--color-blue)' });
  });

  it('applies a custom height and className to the track', () => {
    const { container } = render(<ProgressBar pct={10} color="var(--color-blue)" height={8} className="my-bar" />);
    const track = container.querySelector('.progress-track');
    expect(track).toHaveClass('my-bar');
    expect(track).toHaveStyle({ height: '8px' });
  });
});
