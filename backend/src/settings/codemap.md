# backend/src/settings/

## Responsibility
The app-wide settings store (`settings.json`), the notification system (Apprise + per-event catalog), and the schedule/cron matching helpers every background scheduler relies on.

## Design
- `store.ts` (`SettingsStore`): owns `settings.json` with full `DEFAULTS`, deep-merged per nested section on `update()` (so a partial patch never clobbers a sibling field), and one-time migrations on `load()` for legacy shapes (pre-split `tempAlerts`, bare-boolean `eventTypes`, pre-restructure `backupSchedule.destDir`). Same cache + serialized write-queue + atomic write-then-rename pattern as the other stores; `get()` returns deep copies so callers can't mutate the cache.
- `notificationCatalog.ts`: the single source of truth for 19 `NotificationEventType`s (label, severity, defaultEnabled, optional group). Each event has two channels — `apprise` (external send) and `webui` (in-app bell/toast) — and `DEFAULT_EVENT_TYPES` seeds `webui: true` for everything while `apprise` keeps the catalog's own default.
- `notify.ts`: `sendAppriseNotification` shells out to the real `apprise` CLI via `execFile` (URLs as separate argv entries, never a shell string), with a clear ENOENT message when apprise isn't installed. `notifyEvent` gates on master `enabled` + the per-event `apprise` toggle + non-empty URLs, and swallows every failure so a bad target never breaks the caller's own request/tick.
- `scheduleMatch.ts`: `scheduleMatchesHour` (daily/weekly/monthly — used by parity and cache mover) and `scheduleMatches` (adds `'cron'` — used by backups and rclone sync jobs); `scheduleFireKey` produces a date- or minute-granularity dedupe key per schedule.
- `cronMatch.ts`: dependency-free 5-field cron matcher supporting `*`, bare numbers, comma lists, and `*/step`; `validateCronExpression` rejects bad input at save time.
- `backupEncryption.ts`: `resolveEncryptionPatch` obscures a freshly-typed password via `RcloneClient.obscure()` (blank password = keep the saved one); `redactEncryption` turns the persisted value into `{enabled, hasPassword}` so the obscured secret never leaves the server.

## Flow
`GET /settings` → `redactSettings(store.get())`. `PUT /settings` → live-apply turboWrite/trustProxy, validate schedules/notifications/tempAlerts, resolve any encryption patch → `store.update` → re-mount shares if `minFreeSpaceGb` changed. Schedulers and the activity watcher call `store.get()` each tick; events flow through `notifyEvent` → `sendAppriseNotification`.

## Integration
Consumed by nearly every domain — parity, activity watcher, cache, tailscale, rclone, backups, and `routes/settings.ts`. Depends on the rclone client (obscure/reveal) and `config`.
