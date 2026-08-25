# src/components/shared/

## Responsibility

Presentational and interaction primitives reused across feature folders. These are generic, prop-driven components with no feature logic of their own.

## Design

- `Card`: minimal container div with an optional `className`.
- `ProgressBar`: track + fill; supports `pct`, a fixed `color`/`height`, and an `indeterminate` animated-sweep mode (ignores `pct`).
- `ToggleSwitch`: accessible pill switch (`on`/`onToggle`/`label`/`disabled`) colored from `COLORS`.
- `RoundCheckbox`: small circular checkbox mirroring `ToggleSwitch`'s prop shape for side-by-side per-row controls.
- `StatusDot`: inline colored dot (size/color configurable).
- `TimeSeriesChart`: hand-rolled multi-line SVG chart (no charting library). Tracks container width via `ResizeObserver`, computes axis padding from the widest label, shares hover time across a group via `useChartHover` (`ChartHoverProvider`), and renders crosshair, tooltip, gridlines, and an optional legend; `formatValue`/`formatTs` let callers override axes (e.g. a benchmark's elapsed-seconds domain).
- `PathAutocomplete`: debounced (150ms) directory completion from `browseApi.suggest`, scoped by `scope` to match the caller's validation roots; supports keyboard navigation (arrows/Enter/Escape), click-outside close, and immediate descend-on-select like shell tab-completion.
- `ArrayActionErrorBanner`: shared plain-error banner; when `stopBlockedByContainers` it either renders nothing (global modal handles it) or shows an inline "Stop Docker/LXC and retry" button via `onRetryWithStopContainers`.
- `ArrayStopBlockedModal`: global modal for the stop-array retry prompt, reading `stopBlockedByContainers`/`arrayPending`/`toggleArray`/`dismissActionError` from `useArrayStatus` - mounted in `AppShell` so it works from any page.
- `ReloadDriverPrompt`: two-step "Reload Driver" modal (`nmdApi.reloadDriver`) with an optional stop-containers checkbox, shared by the dashboard error/parity cards and Settings.

## Flow

Mostly stateless. `TimeSeriesChart` reads and writes shared hover state through `ChartHoverContext`; `PathAutocomplete` owns its suggestions/request-id/debounce locally and calls `onChange` with the raw value.

## Integration

Consumed by every feature folder: `TimeSeriesChart` by `HistoryPage` and `BenchmarkSection`; `PathAutocomplete` by browse/docker/apps/settings; `ToggleSwitch`/`RoundCheckbox` by shares/settings; `ReloadDriverPrompt` by dashboard and settings; `ArrayStopBlockedModal` and `ArrayActionErrorBanner` by the array-action flows. Styling via `src/styles/*.css` with tokens from `tokens.css`.
