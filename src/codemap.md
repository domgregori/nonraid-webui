# src/

## Responsibility
Frontend entry point of the NAS dashboard. Wires the router, authentication gate, global providers, and the top-level route table together, and imports the stylesheet chain.

## Design
- `main.tsx` renders `<StrictMode><BrowserRouter><AuthProvider><AuthGate/></AuthProvider></BrowserRouter>` into `#root` (index.html).
- `AuthGate.tsx` is the single pre-auth branch: while `loadState` is `'loading'`/`'error'` it renders a bare screen, otherwise it routes to `SetupPage` (not configured), `LoginPage` (not authenticated), or the provider stack `ArrayStatusProvider → SettingsProvider → NotificationsProvider → OnboardingGate`.
- The providers only mount once authenticated, so their background polls never fire during login/setup (no 401 spam).
- `App.tsx` is a thin route table inside `AppShell` (all 11 pages, `*` → `NotFoundPage`).
- `index.css` is only an ordered `@import` list of `styles/*.css`.

## Flow
1. `main.tsx` mounts and `AuthProvider` calls `authApi.status()` to settle `configured`/`authenticated`.
2. `AuthGate` picks the branch; once authenticated it mounts the provider stack.
3. `OnboardingGate` decides first-run wizard vs dashboard (it always renders `App` underneath), so the route table is untouched by auth.
4. `App` matches the URL and renders the page inside `AppShell`.

## Integration
- Consumers/imports: `state/AuthProvider`, `state/*Provider` stack, `pages/*`, `components/layout/AppShell`, `components/onboarding/OnboardingGate`, `styles/*`.
- Nothing inside `src/` is imported by code outside `src/`; it is the tree root.
