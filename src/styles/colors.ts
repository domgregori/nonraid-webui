/**
 * Live references into tokens.css's custom properties, for selectors/components
 * that need a color as a plain string (inline styles, SVG fill/stroke) rather
 * than through a CSS class. Using var() rather than literal values means these
 * automatically follow the active theme (light/dark/system) - no separate
 * light-mode copy to keep in sync.
 */
export const COLORS = {
  bg: 'var(--color-bg)',
  surface: 'var(--color-surface)',
  surfaceElevated: 'var(--color-surface-elevated)',
  border: 'var(--color-border)',
  borderLit: 'var(--color-border-lit)',
  text: 'var(--color-text)',
  textSecondary: 'var(--color-text-secondary)',
  textDim: 'var(--color-text-dim)',
  blue: 'var(--color-blue)',
  green: 'var(--color-green)',
  amber: 'var(--color-amber)',
  red: 'var(--color-red)',
  chartPurple: 'var(--color-chart-purple)',
  chartCyan: 'var(--color-chart-cyan)',
  chartPink: 'var(--color-chart-pink)',
  chartLime: 'var(--color-chart-lime)',
} as const;

export function tint(color: string, pct: number): string {
  return `color-mix(in oklch, ${color} ${pct}%, transparent)`;
}
