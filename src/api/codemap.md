# src/api/

## Responsibility
The entire HTTP layer. One module per backend domain (nmd, auth, system, docker, lxc, shares, users, browse, apps, cache, rclone, tls, tailscale, smart, metrics, logs, activity, emptyDisk, diskQueue, services, settings), all funneled through `request.ts`, plus `progressStream.ts` for streaming endpoints.

## Design
- Every domain file exports a plain `const xxxApi = { ... }` object literal of methods. Each method calls `request<T>(path, init)` (or `streamNdjson`) and returns a typed promise; no axios, no per-call fetch setup.
- `request.ts`: `fetch(`${API_BASE_URL}${path}`, { ...init, credentials: 'include' })`. On 401 it fires the globally-registered `onUnauthorized` handler (set by `AuthProvider`) and throws `UnauthorizedError`; on other non-ok it throws `CodedError` (when the body carries a `code`, e.g. `ARRAY_NOT_CONFIGURED`, `PASSWORD_REQUIRED`) or a plain `Error`.
- `config.ts` derives `API_BASE_URL` from `VITE_API_BASE_URL`, falling back to `''` in prod (same origin) or `http://localhost:3001` in dev.
- `progressStream.ts` reads NDJSON (`{type:'progress',…}` / `{type:'done',result}` / `{type:'error',message}`), generic over tick/result shapes, used by apps install, docker create/recreate/move-storage, lxc create/move-storage, and browse bulk ops.
- Multipart/FormData uploads (import preview, TLS import, browse upload) bypass JSON and rely on `request`'s generic init.

## Flow
1. Hook or component calls `api.method(...)`.
2. `request` sends the fetch with cookies; JSON responses are parsed and returned.
3. A 401 anywhere → `onUnauthorized` → `AuthProvider` sets `authenticated=false` → `AuthGate` remounts `LoginPage`.
4. Coded errors bubble up to the caller, which matches on `err.code` (e.g. `ArrayStatusProvider` treats `ARRAY_NOT_CONFIGURED` as the `not-configured` load state).
5. Streaming endpoints push progress ticks to an `onProgress` callback until `done`/`error`.

## Integration
- Imported by every hook (`useArrayStatus` → `nmdApi`, `useSettings` → `settingsApi`, etc.), state providers (`AuthProvider`, `ArrayStatusProvider`, `NotificationsProvider`, `SettingsProvider`, `OnboardingGate`), and a few pages/components directly (SettingsPage, StorageLocationField).
- `request.ts`'s `setUnauthorizedHandler` couples it to `state/AuthProvider`.
- Types come from `../types/*` (mirror files of the backend).
