const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: h === 0 ? '12:00 AM' : h < 12 ? `${h}:00 AM` : h === 12 ? '12:00 PM' : `${h - 12}:00 PM`,
}));
// 1-28 only - every month has at least 28 days, so this sidesteps "the 30th
// doesn't exist in February" without needing month-length logic, matching
// backend/src/settings/types.ts's WeeklyOrMonthlySchedule.dayOfMonth.
const DAY_OF_MONTH_OPTIONS = Array.from({ length: 28 }, (_, i) => i + 1);

interface ScheduleFieldsProps {
  frequency: 'daily' | 'weekly' | 'monthly';
  onFrequencyChange: (frequency: 'daily' | 'weekly' | 'monthly') => void;
  dayOfWeek: number;
  onDayOfWeekChange: (day: number) => void;
  dayOfMonth: number;
  onDayOfMonthChange: (day: number) => void;
  hour: number;
  onHourChange: (hour: number) => void;
  disabled?: boolean;
}

/** Daily/weekly/monthly + day + hour picker shared by the Parity, Backups, and Cache mover schedule
 *  cards. Daily has no day picker at all - only the hour matters. */
export function ScheduleFields({
  frequency,
  onFrequencyChange,
  dayOfWeek,
  onDayOfWeekChange,
  dayOfMonth,
  onDayOfMonthChange,
  hour,
  onHourChange,
  disabled,
}: ScheduleFieldsProps) {
  return (
    <>
      <div className="settings-field__row">
        <select
          className="history-input"
          value={frequency}
          onChange={(e) => onFrequencyChange(e.target.value as 'daily' | 'weekly' | 'monthly')}
          disabled={disabled}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
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
        <select className="history-input" value={hour} onChange={(e) => onHourChange(Number(e.target.value))} disabled={disabled}>
          {HOUR_OPTIONS.map((h) => (
            <option key={h.value} value={h.value}>
              {h.label}
            </option>
          ))}
        </select>
      </div>
      {frequency === 'monthly' && <div className="toggle-row__desc">Only days 1-28 are offered, so every month always has a matching date.</div>}
    </>
  );
}
