import { cronMatches } from './cronMatch.js';
import type { RecurringSchedule } from './types.js';

/** Shared by ParityScheduler and CacheMoverScheduler - neither offers the 'cron' frequency in its
 *  own UI, so this only ever needs to compare daily/weekly/monthly against the current server-local
 *  time on a 1-minute tick. BackupScheduler/RcloneSyncScheduler use scheduleMatches below instead,
 *  since Local Backups and every remote sync job also offer a 'cron' schedule. */
export function scheduleMatchesHour(schedule: RecurringSchedule, now: Date): boolean {
  if (now.getHours() !== schedule.hour) return false;
  if (schedule.frequency === 'daily') return true;
  return schedule.frequency === 'monthly' ? now.getDate() === schedule.dayOfMonth : now.getDay() === schedule.dayOfWeek;
}

/** Same idea as scheduleMatchesHour, plus a 'cron' frequency (backed by cronMatch.ts) - used by
 *  every schedule that offers the "Cron format" option (Local Backups, each remote sync job). */
export function scheduleMatches(schedule: RecurringSchedule, now: Date): boolean {
  if (schedule.frequency === 'cron') return cronMatches(schedule.cronExpression, now);
  return scheduleMatchesHour(schedule, now);
}

/**
 * A key that changes exactly once per interval this schedule could next fire at - used to dedupe
 * a scheduler's per-minute tick so one matching minute doesn't refire the same job repeatedly.
 * Daily/weekly/monthly only ever match once within a given calendar day (their own frequency check
 * is hour-granularity, not minute), so a date-only key is enough there; 'cron' can legitimately
 * match several times a day (e.g. "0 * * * *", hourly), so it needs minute-granularity instead.
 */
export function scheduleFireKey(schedule: RecurringSchedule, now: Date): string {
  return schedule.frequency === 'cron' ? now.toISOString().slice(0, 16) : now.toISOString().slice(0, 10);
}
