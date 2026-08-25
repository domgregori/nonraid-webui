# backend/src/activity/

## Responsibility
The rolling recent-activity feed (persisted to `activity.json`, newest-first, capped at 500 entries) plus a passive 30-second poller that logs externally-initiated state changes and fires matching notifications.

## Design
- `store.ts` (`ActivityStore`): same cache + serialized write-queue + atomic write-then-rename pattern as the other stores. `log(text, color, eventType?)` prepends an entry `{id, timestamp, text, color, eventType?}`; `list(limit)` is a plain slice (entries stored newest-first). Fire-and-forget from call sites' point of view — callers use `.catch(() => {})` so a rare disk-write failure can never mask the real action's outcome.
- `watcher.ts` (`ActivityWatcher`): a self-unref'd 30s ticker. Everything is a *passive observation* — it only reads `nmd.getStatus()`, SMART, cache status, and CPU temps; it never issues driver commands. The seed-then-diff idiom means the first tick after startup snapshots state silently, so a restart never replays a wall of false "just changed" events.
- Edge-triggered on worsening states only, never on recovery (the dashboard UI already shows recovery the moment it happens): `checkArrayError` (entering a new `ERROR:*` state), `checkParitySync` (sync completion/errors by timestamp change), `checkDisks` (error count climbing, or status turning bad — `DISK_NP_DSBL` excluded as a normal unassigned state), `checkNeedsFormat` (only while array `STARTED`), `checkSmartHealth` (passed → failed), `checkTemperatures` (threshold crossings, once per crossing via an `overTemp` map), `checkCacheMirror` (healthy → degraded/unavailable).
- `types.ts`: `ActivityColor` maps to the UI's blue/green/amber/red status dots; `eventType` ties an entry to a `notificationCatalog` event so the in-app bell can mute per-event while the History view stays unfiltered.

## Flow
Explicit user actions log directly from route handlers/schedulers (e.g. `activity.log('Array started', 'green', 'arrayStarted')`). The watcher tick → `nmd.getStatus()` → each `check*` method diffs against its snapshot map and, on a worsening transition, calls `activity.log(...)` + `notifyEvent(...)`. `GET /activity?limit=N` → `store.list`.

## Integration
Consumed by essentially every route and scheduler in the app. Consumes `nmd`, `smart`, `cache`, and `settings` (temp thresholds + `notifyEvent`). Exposed via `routes/activity.ts`.
