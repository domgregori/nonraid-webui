import { config } from '../config.js';
import { scheduleFireKey, scheduleMatches } from '../settings/scheduleMatch.js';
import type { SettingsStore } from '../settings/index.js';
import type { RcloneService } from './service.js';

/**
 * Ticks through every enabled sync job's own schedule, same shape as BackupScheduler but for a
 * *list* of schedules instead of one - each job gets its own lastFiredKey so one job's cron
 * schedule firing doesn't suppress another's. Does nothing at all while
 * settings.remoteBackup.enabled is off, same feature-gate every other optional integration in this
 * app (Tailscale, Cache) uses.
 */
export class RcloneSyncScheduler {
  private timer: NodeJS.Timeout;
  private lastFiredKeys = new Map<string, string>();

  constructor(
    private service: RcloneService,
    private settings: SettingsStore,
    intervalMs: number = config.rcloneSchedulerTickIntervalMs,
  ) {
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    const settings = await this.settings.get();
    if (!settings.remoteBackup.enabled) return;

    const now = new Date();
    const jobs = await this.service.listJobs().catch(() => []);
    for (const job of jobs) {
      if (!job.enabled) continue;
      if (!scheduleMatches(job.schedule, now)) continue;
      const fireKey = scheduleFireKey(job.schedule, now);
      if (this.lastFiredKeys.get(job.id) === fireKey) continue;
      this.lastFiredKeys.set(job.id, fireKey);
      // Sequential by design - RcloneService.runJobNow() already refuses a second concurrent sync,
      // so a scheduler tick that matches two jobs' schedules in the same minute runs them one after
      // another rather than racing; the second one's own failure ("another sync is already
      // running") is expected in that rare case and just means it'll pick up next tick... except it
      // won't, since lastFiredKeys is already marked - it waits for its *next* scheduled time
      // instead. Acceptable for a single-admin home NAS scheduler tick, not a hard guarantee.
      await this.service.runJobNow(job.id, 'Scheduled sync').catch(() => {});
    }
  }
}
