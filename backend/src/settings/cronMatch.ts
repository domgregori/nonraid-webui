// A small standard 5-field cron matcher ("minute hour day month weekday") - deliberately not a
// dependency: this only ever needs to answer "does `now` match this expression", once a minute,
// for the handful of schedules this app has (Local Backups, each Remote Backup sync job). Supports
// the subset of syntax those realistically need: `*`, a bare number, comma lists ("1,15"), and
// `*/step` - not ranges ("1-5") or step-on-a-list ("1,15/2"), which nothing in this app's own
// schedule editor (ScheduleFields' cron text input) prompts a user to type.
function parseField(field: string, min: number, max: number): Set<number> {
  if (field === '*') {
    const all = new Set<number>();
    for (let i = min; i <= max; i++) all.add(i);
    return all;
  }
  const step = field.match(/^\*\/(\d+)$/);
  if (step) {
    const n = Number(step[1]);
    const values = new Set<number>();
    for (let i = min; i <= max; i += n) values.add(i);
    return values;
  }
  const values = new Set<number>();
  for (const part of field.split(',')) {
    const n = Number(part.trim());
    if (Number.isInteger(n)) values.add(n);
  }
  return values;
}

/** Throws with a human-readable message on malformed input - callers (routes/settings.ts,
 *  routes/rclone.ts) use this to reject a bad cron expression at save time rather than letting it
 *  silently never fire. */
export function validateCronExpression(expr: string): void {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Cron expression must have 5 fields (minute hour day month weekday), got ${fields.length}.`);
  }
  const ranges: [number, number][] = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7], // both 0 and 7 mean Sunday, same as standard cron
  ];
  fields.forEach((field, i) => {
    const [min, max] = ranges[i]!;
    if (!/^(\*|\*\/\d+|\d+(,\d+)*)$/.test(field)) {
      throw new Error(`Cron field "${field}" isn't understood - use "*", a number, a comma list, or "*/N".`);
    }
    for (const v of parseField(field, min, max)) {
      if (v < min || v > max) {
        throw new Error(`Cron field "${field}" is out of range (expected ${min}-${max}).`);
      }
    }
  });
}

/** True when `now` (server-local time) matches every field of `expr`. Field 5 (weekday) treats 0
 *  and 7 as the same Sunday, matching standard cron. */
export function cronMatches(expr: string, now: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour, day, month, weekday] = fields as [string, string, string, string, string];
  if (!parseField(minute, 0, 59).has(now.getMinutes())) return false;
  if (!parseField(hour, 0, 23).has(now.getHours())) return false;
  if (!parseField(day, 1, 31).has(now.getDate())) return false;
  if (!parseField(month, 1, 12).has(now.getMonth() + 1)) return false;
  const weekdaySet = parseField(weekday, 0, 7);
  const nowWeekday = now.getDay();
  if (!weekdaySet.has(nowWeekday) && !(nowWeekday === 0 && weekdaySet.has(7))) return false;
  return true;
}
