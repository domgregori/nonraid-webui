# backend/src/parity/

## Responsibility
Automatic scheduled parity checks: fire an nmd correcting parity check when the stored weekly/monthly schedule matches the current server-local time.

## Design
- `scheduler.ts` (`ParityScheduler`): a self-unref'd 1-minute ticker (no cron dependency needed for hour-granularity triggers). Each tick reads the live `settings.paritySchedule` via `SettingsStore` — the schedule is always read fresh, never cached, so a Settings change takes effect on the next tick.
- `scheduleMatchesHour` (from `settings/scheduleMatch.ts`) compares hour, then `daily` (always) / `weekly` (dayOfWeek) / `monthly` (dayOfMonth). Parity never offers the `'cron'` frequency.
- A date-only `lastFiredDateKey` dedupes fires within the same calendar day. It's in-memory only — a backend restart during the scheduled hour could refire that same day, accepted as fine for a convenience feature.
- Guards before firing: schedule disabled → skip; driver unreachable (`getStatus` throws) → skip this tick; array not `STARTED` or a resync already active → skip.

## Flow
Tick → `settings.get()` → if `!paritySchedule.enabled` return → `scheduleMatchesHour(schedule, now)` → dedupe by date key → `nmd.getStatus()` → `nmd.parityCheck('CORRECT')` → `activity.log('Parity check started automatically (scheduled)', 'blue', 'parityStarted')` + `notifyEvent(parityStarted)`. A failed start logs an error to the activity feed but never throws out of the tick.

## Integration
Constructed in `index.ts` with `nmd`, `settingsStore`, and `activity`. Shares its matching helpers with the cache mover, and its event/logging path with `routes/parity.ts` (manual start/stop/cancel actions).
