# src/styles/

## Responsibility
All styling: theme tokens and per-feature stylesheets, plus the `COLORS`/`tint` module that lets TS code reference theme colors as strings.

## Design
- `tokens.css` defines CSS custom properties in oklch for the light palette (`:root`), the dark palette (a `prefers-color-scheme: dark` media query scoped `:root:not([data-theme='light'])`, plus an explicit `:root[data-theme='dark']` for manual selection), semantic colors (`--color-blue/green/amber/red`), extra chart swatches (`--color-chart-purple/cyan/pink/lime`), tint helpers (`--color-blue-tint`, …), fonts (`--font-ui`, `--font-mono`), radii (`--radius-*`), and spacing (`--space-*`), plus the `pulse-dot` keyframes.
- `colors.ts` exports `COLORS` (each value is a `var(--color-*)` reference, so inline styles auto-follow the active theme) and `tint(color, pct)` which emits `color-mix(in oklch, …)`.
- The remaining files are plain per-feature CSS (global, layout, dashboard, list-card, docker, settings, history, disk-detail, dialog, browse, users, apps, auth, onboarding), class-named after components (BEM-ish `block__elem--mod`). Theme switching is purely via `data-theme` on `<html>` (see `hooks/useTheme.ts` and the blocking script in `index.html`).

## Flow
`src/index.css` `@import`s every stylesheet in one order (tokens → global → layout → dashboard → … → onboarding). `tokens.css` supplies the custom properties; `index.html` sets `data-theme` before first paint; components use class names from these files, and inline colors come from `COLORS`/`tint`.

## Integration
- `tokens.css` is imported by `global.css` and via `index.css`.
- `colors.ts` is imported by `src/selectors/*` (status, disks, parity, containers, lxcContainers, services, users, browse), `HistoryPage`, `SharesPage`, and shared components.
- Consumed by every component under `src/components/*` via class names.
