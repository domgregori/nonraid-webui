# src/pages/

## Responsibility
Route-level page components — one per top-level tab plus the pre-auth screens and the 404 fallback. Each page composes hooks, selectors, and components into a screen.

## Design
- Pages are thin composition layers: they call one or more hooks (`useShares`, `useArrayStatus`, `useApps`, …), derive view models with selectors (`deriveShareViewModel`, `deriveContainerViewModel`, `deriveDisk`, `deriveProtection`, `deriveDegradedReasons`, `LOCATION_TYPE_*`), and render list/card layouts plus modals/detail panels.
- Local UI state lives in the page via `useState`: open dialogs (`ShareFormModal`, `ContainerFormDialog`, `AppDetailPanel`, …), two-click delete confirmation (`confirmingDelete`/`confirmingDestroy`/`confirmingGroupDelete`), and selection.
- `DashboardPage` renders the dashboard card grid (StatCards, ArrayDisks, ParityCheckCard, SystemCard, …) gated on `loadState !== 'not-configured'`; `DisksPage` adds BootDiskDetailPanel, CacheSection, UnassignedDevicesCard.
- `SettingsPage` is a single large sectioned screen: a `SECTIONS` sidebar, deep-linking via `location.hash` (`SECTION_IDS` set guards stale hashes), and many `*Draft`/`*Saving`/`*Error` state pairs, seeded once from server data via `*Initialized` refs so re-polls never clobber mid-typing input.
- `HistoryPage` switches between DB-backed `useMetrics` and live `useLiveMetrics` (`ViewMode = MetricRange | 'live'`), wrapped in `ChartHoverProvider` for cross-chart crosshairs.
- `LoginPage` runs the password→2FA sub-flow (`step: 'password' | 'twofactor'`); `SetupPage` is the first-run admin-account form; `NotFoundPage` is a `<Navigate to="/" replace/>`.

## Flow
1. `App.tsx` (inside `AppShell`) matches the route and renders the page; `AuthGate` renders `LoginPage`/`SetupPage` before auth.
2. The page mounts its hooks (starting their polls), maps raw data through selectors, and renders.
3. User interactions toggle local dialog state; dialog `onSubmit` handlers call hook actions and close the modal only when they return `true`.

## Integration
- Registered in `App.tsx`'s `<Routes>` (`/`, `/disks`, `/shares`, `/browse`, `/users`, `/docker`, `/lxc`, `/apps`, `/history`, `/settings`, `*`).
- Import from `src/components/*`, `src/hooks/*`, `src/selectors/*`, `src/state/*`, `src/api/*` (SettingsPage), `src/utils/format`, `src/styles/colors`.
