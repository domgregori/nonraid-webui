# src/state/

## Responsibility
Global client state via React Context. Owns the app's polling "heartbeat" (array status), auth/session, persisted settings, notifications/toasts, chart-hover sync, and the onboarding replay flag.

## Design
- Triad per feature: a `XxxContext.ts` defining `createContext<T|null>(null)` + the value interface (+ a `useXxx` accessor file that throws outside the provider), and a `XxxProvider.tsx` that owns all state and effects.
- `ArrayStatusProvider` is the heartbeat: polls `nmdApi.getStatus()` every `STATUS_POLL_MS = 2000` (plus `smartApi` temps/health every 15s; disk types fetched once). Exposes status, `loadState` (`'loading'|'ready'|'error'|'not-configured'`), temps/health/types keyed by device, `selectedDiskId`, pending flags (`arrayPending`, `parityPending`, `unassignPending`, `restorePending`), and actions that call the api then `refreshStatus()` (`toggleArray`, `parityAction`, `unassignDisk`, `restoreDisk`, `selectDisk`, `dismissActionError`). `actionError` + `stopBlockedByContainers` support the retry-with-stopContainers flow.
- `AuthProvider` calls `authApi.status()` once, holds `configured`/`authenticated`/`loadState`, and registers the global 401 handler via `request.ts`'s `setUnauthorizedHandler` — any 401 anywhere flips `authenticated` off. `login()` returns a `LoginOutcome` (`{ok:false, twoFactorRequired, methods}`) instead of throwing when a second factor is needed.
- `SettingsProvider` fetches settings once and shares them (SettingsPage + HeaderClock), with `update(patch)` re-broadcasting the server's full response.
- `NotificationsProvider` polls `activityApi.list(30)` every 8s, diffs against a `knownIds` ref (seeds silently on first poll), mutes webui-disabled event types, toasts only amber/red entries, tracks an unread badge via `localStorage` `lastSeenId`, and auto-dismisses toasts after 7s.
- `ChartHoverProvider`/`ChartHoverContext` sync a shared `hoverTs` across the History page's `TimeSeriesChart`s (with a local-state fallback for charts used without a provider).
- `OnboardingContext` provides `replay()` (the wizard lives in `OnboardingGate`, which also creates this context).

## Flow
1. `AuthGate` mounts providers only after authentication; `main.tsx` mounts `AuthProvider` directly under `BrowserRouter`.
2. Provider effects start their interval polls on mount and clear them on unmount.
3. Components read via `useArrayStatus()` / `useAuth()` / `useSettings()` / `useNotifications()`; actions go provider → api → state → re-render.
4. A 401 from any api call routes through `AuthProvider`'s handler → `authenticated=false` → `AuthGate` shows `LoginPage`.

## Integration
- Imported by `main.tsx` (`AuthProvider`), `AuthGate.tsx` (provider stack), `OnboardingGate` (settingsApi + OnboardingContext), and consumed app-wide via the `src/hooks/useX.ts` accessor re-exports (`useSettings` in hooks/ actually wraps `SettingsContext`).
- Depends on `src/api` (`nmdApi`, `smartApi`, `authApi`, `settingsApi`, `activityApi`, `request`), `src/types`, and `localStorage`.
