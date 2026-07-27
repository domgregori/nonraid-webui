/**
 * TS mirror of the palette in tokens.css, for selectors that need to
 * pick a color programmatically. Keep values byte-identical to tokens.css.
 */
export const COLORS = {
  bg: 'oklch(0.16 0.02 260)',
  surface: 'oklch(0.21 0.02 260)',
  surfaceElevated: 'oklch(0.25 0.02 260)',
  border: 'oklch(0.32 0.02 260)',
  borderLit: 'oklch(0.4 0.03 260)',
  text: 'oklch(0.93 0.01 260)',
  textSecondary: 'oklch(0.68 0.02 260)',
  textDim: 'oklch(0.52 0.02 260)',
  blue: 'oklch(0.68 0.14 240)',
  green: 'oklch(0.72 0.15 145)',
  amber: 'oklch(0.78 0.15 80)',
  red: 'oklch(0.64 0.19 25)',
} as const;

export function tint(color: string, pct: number): string {
  return `color-mix(in oklch, ${color} ${pct}%, transparent)`;
}
