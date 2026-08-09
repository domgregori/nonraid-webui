import type { ActivityStore } from '../activity/index.js';
import { config } from '../config.js';
import type { NmdClient } from '../nmd/index.js';
import type { SettingsStore } from '../settings/index.js';

/**
 * Fires an automatic correcting parity check at the configured weekly
 * day/hour, in the server's own local time. nmdctl has no scheduling of its
 * own, so this lives entirely here — no cron dependency needed, a 1-minute
 * tick comparing against the stored schedule is enough for an hour-granularity
 * weekly trigger. Same self-unref'd background-ticker shape as ActivityWatcher.
 *
 * Caveat: lastFiredDateKey is in-memory only, so a backend restart during the
 * scheduled hour resets it and could refire that same day — acceptable for a
 * convenience feature, not worth persisting.
 */
export class ParityScheduler {
  private timer: NodeJS.Timeout;
  private lastFiredDateKey: string | null = null;

  constructor(
    private nmd: NmdClient,
    private settings: SettingsStore,
    private activity: ActivityStore,
    intervalMs: number = config.paritySchedulerIntervalMs,
  ) {
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    const settings = await this.settings.get();
    const schedule = settings.paritySchedule;
    if (!schedule.enabled) return;

    const now = new Date();
    if (now.getDay() !== schedule.dayOfWeek || now.getHours() !== schedule.hour) return;

    const dateKey = now.toISOString().slice(0, 10);
    if (this.lastFiredDateKey === dateKey) return;
    this.lastFiredDateKey = dateKey;

    let status;
    try {
      status = await this.nmd.getStatus();
    } catch {
      return; // driver unreachable this tick — try again next time
    }
    if (status.array.state !== 'STARTED' || status.resync.active) return;

    try {
      await this.nmd.parityCheck('CORRECT');
      this.activity.log('Parity check started automatically (scheduled)', 'blue').catch(() => {});
    } catch (err) {
      this.activity.log(`Scheduled parity check failed to start: ${(err as Error).message}`, 'red').catch(() => {});
    }
  }
}
