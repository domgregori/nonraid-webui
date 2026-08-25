# src/components/

## Responsibility

All React UI for the NAS dashboard lives here, grouped by feature area rather than by type. The folder is the layer where pages (in `src/pages`) pull their building blocks from and where shared presentational primitives are kept.

## Design

- One subfolder per feature: `layout/` (app chrome), `dashboard/`, `disk-detail/`, `docker/`, `lxc/`, `apps/`, `browse/`, `shares/`, `users/`, `settings/`, `onboarding/`, `auth/`, `activity/`, plus `shared/` for cross-feature primitives.
- Components are mostly controlled/presentational: parent pages own state via `src/hooks/*` and `src/state/*` contexts (`useArrayStatus`, `useNotifications`, `useAuth`) and pass callbacks down.
- Two overlay patterns recur: slide-in `detail-panel` (with `.detail-overlay` backdrop) for inspection UIs, and centered `.dialog` modals for forms/confirmations/wizards.
- Styling is class-name driven against per-area stylesheets in `src/styles/*.css` (kebab-case BEM-ish names); design tokens come from CSS custom properties in `src/styles/tokens.css` (`--color-*`, `--space-*`, `--radius-*`).
- Data access is centralized: `src/api/*` request modules, `src/hooks/*` polling hooks, `src/selectors/*` view-model derivations.

## Flow

`main.tsx` -> `AuthGate` (providers + onboarding gate) -> `App` -> `AppShell` renders the global chrome (`Header`, `NavTabs`, `ToastStack`, global `DiskDetailPanel`, `ArrayStopBlockedModal`) and routes render page components, which compose feature components. Feature components read context/hook state on every poll tick and invoke API modules on user action; dialogs/panels typically mount as conditional overlays and signal completion via `onClose`/`onDone`/`onStarted` callbacks.

## Integration

- `layout/AppShell` is mounted once in `App.tsx`; `onboarding/OnboardingGate` wraps `App` in `AuthGate.tsx`.
- Feature folders are consumed by the matching page in `src/pages/` (e.g. `DashboardPage` uses `dashboard/*`, `SettingsPage` uses `settings/*`).
- `shared/` is imported by nearly every other folder; `dashboard/IconTile` is used by both Docker and LXC widget cards.
