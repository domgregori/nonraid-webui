const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Same 12h/24h choice as the header clock (Settings -> About -> Time format), not hardcoded -
 *  this picker is the one other place in the app a literal clock time is chosen, not just displayed. */
function hourOptions(hour12: boolean): { value: number; label: string }[] {
  return Array.from({ length: 24 }, (_, h) => ({
    value: h,
    label: hour12 ? (h === 0 ? '12:00 AM' : h < 12 ? `${h}:00 AM` : h === 12 ? '12:00 PM' : `${h - 12}:00 PM`) : `${String(h).padStart(2, '0')}:00`,
  }));
}
// 1-28 only - every month has at least 28 days, so this sidesteps "the 30th
// doesn't exist in February" without needing month-length logic, matching
// backend/src/settings/types.ts's WeeklyOrMonthlySchedule.dayOfMonth.
const DAY_OF_MONTH_OPTIONS = Array.from({ length: 28 }, (_, i) => i + 1);

interface ScheduleFieldsProps {
  frequency: 'daily' | 'weekly' | 'monthly' | 'cron';
  onFrequencyChange: (frequency: 'daily' | 'weekly' | 'monthly' | 'cron') => void;
  dayOfWeek: number;
  onDayOfWeekChange: (day: number) => void;
  dayOfMonth: number;
  onDayOfMonthChange: (day: number) => void;
  hour: number;
  onHourChange: (hour: number) => void;
  hour12: boolean;
  disabled?: boolean;
  // Opt-in per caller (Local Backups, each Remote Backup sync job) - Parity and the Cache mover
  // schedule cards don't offer this option, so they simply never pass it.
  allowCron?: boolean;
  cronExpression?: string;
  onCronExpressionChange?: (expr: string) => void;
}

/** Daily/weekly/monthly(/cron) + day + hour picker shared by the Parity, Backups, Cache mover, and
 *  Remote Backup sync job schedule cards. Daily has no day picker at all - only the hour matters;
 *  cron replaces both the day and hour pickers with a raw cron-expression input. */
export function ScheduleFields({
  frequency,
  onFrequencyChange,
  dayOfWeek,
  onDayOfWeekChange,
  dayOfMonth,
  onDayOfMonthChange,
  hour,
  onHourChange,
  hour12,
  disabled,
  allowCron,
  cronExpression,
  onCronExpressionChange,
}: ScheduleFieldsProps) {
  return (
    <>
      <div className="settings-field__row">
        <select
          className="history-input"
          value={frequency}
          onChange={(e) => onFrequencyChange(e.target.value as 'daily' | 'weekly' | 'monthly' | 'cron')}
          disabled={disabled}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          {allowCron && <option value="cron">Cron format</option>}
        </select>
        {frequency === 'weekly' && (
          <select className="history-input" value={dayOfWeek} onChange={(e) => onDayOfWeekChange(Number(e.target.value))} disabled={disabled}>
            {DAY_NAMES.map((day, i) => (
              <option key={day} value={i}>
                {day}
              </option>
            ))}
          </select>
        )}
        {frequency === 'monthly' && (
          <select className="history-input" value={dayOfMonth} onChange={(e) => onDayOfMonthChange(Number(e.target.value))} disabled={disabled}>
            {DAY_OF_MONTH_OPTIONS.map((day) => (
              <option key={day} value={day}>
                Day {day}
              </option>
            ))}
          </select>
        )}
        {frequency !== 'cron' && (
          <select className="history-input" value={hour} onChange={(e) => onHourChange(Number(e.target.value))} disabled={disabled}>
            {hourOptions(hour12).map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {frequency === 'monthly' && <div className="toggle-row__desc">Only days 1-28 are offered, so every month always has a matching date.</div>}
      {frequency === 'cron' && (
        <label className="field" style={{ marginTop: 8 }}>
          <span className="settings-field__label">Cron expression</span>
          <input
            className="history-input"
            style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
            value={cronExpression ?? ''}
            onChange={(e) => onCronExpressionChange?.(e.target.value)}
            placeholder="* * * * *"
            disabled={disabled}
          />
          <span className="settings-field__hint">minute hour day month weekday</span>
        </label>
      )}
    </>
  );
}
