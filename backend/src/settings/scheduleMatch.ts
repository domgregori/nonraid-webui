import type { RecurringSchedule } from './types.js';

/** Shared by ParityScheduler, BackupScheduler, and CacheMoverScheduler — all three compare a
 *  stored daily/weekly/monthly schedule against the current server-local time on a 1-minute tick. */
export function scheduleMatchesHour(schedule: RecurringSchedule, now: Date): boolean {
  if (now.getHours() !== schedule.hour) return false;
  if (schedule.frequency === 'daily') return true;
  return schedule.frequency === 'monthly' ? now.getDate() === schedule.dayOfMonth : now.getDay() === schedule.dayOfWeek;
}
