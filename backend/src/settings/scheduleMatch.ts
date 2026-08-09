import type { WeeklyOrMonthlySchedule } from './types.js';

/** Shared by ParityScheduler and BackupScheduler — both compare a stored weekly/monthly
 *  schedule against the current server-local time on a 1-minute tick. */
export function scheduleMatchesHour(schedule: WeeklyOrMonthlySchedule, now: Date): boolean {
  if (now.getHours() !== schedule.hour) return false;
  return schedule.frequency === 'monthly' ? now.getDate() === schedule.dayOfMonth : now.getDay() === schedule.dayOfWeek;
}
