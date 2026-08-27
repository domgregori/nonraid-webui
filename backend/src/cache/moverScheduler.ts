import type { ActivityStore } from '../activity/index.js';
import { config } from '../config.js';
import type { NmdClient } from '../nmd/index.js';
import { scheduleMatchesHour } from '../settings/scheduleMatch.js';
import type { SettingsStore } from '../settings/store.js';
import { notifyEvent } from '../settings/notify.js';
import type { CacheMoverService } from './mover.js';

/**
 * Fires the mover on the configured schedule, same self-unref'd tick shape as
 * ParityScheduler/BackupScheduler. Also doubles as the mover job's own completion watcher: unlike
 * parity (whose completion nmdctl reports natively, see ActivityWatcher.checkParitySync()), the
 * mover job's state lives only in CacheMoverService's own in-memory FileMoveService - nothing
 * external to poll for a "did it finish" signal - so this scheduler's own recurring tick doubles
 * as that watcher, tracking status() transitions regardless of whether the run was scheduled or
 * triggered manually via POST /cache/mover/run.
 */
export class CacheMoverScheduler {
  private timer: NodeJS.Timeout;
  private lastFiredDateKey: string | null = null;
  // undefined means "not observed yet" - seeded silently on the first tick so a backend restart
  // mid-run (or right after one finished) never produces a false completion notification. Tracking
  // finishedAt itself, not just status, matters: a move that completes in well under one tick
  // interval (confirmed live - a small single-file move finished in under a second) can go
  // idle -> running -> done between two polls with neither ever observing "running", so a plain
  // status-transition diff silently misses it. finishedAt changes exactly once per run regardless
  // of how fast that run was, so diffing it catches every completion, not just slow ones.
  private lastFinishedAt: number | null | undefined = undefined;

  constructor(
    private mover: CacheMoverService,
    private nmd: NmdClient,
    private settings: SettingsStore,
    private activity: ActivityStore,
    intervalMs: number = config.schedulerTickIntervalMs,
  ) {
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref();
  }

  private checkJobCompletion(): void {
    const job = this.mover.status();
    const prevFinishedAt = this.lastFinishedAt;
    this.lastFinishedAt = job.finishedAt;
    if (prevFinishedAt === undefined) return; // first tick ever - seed silently
    if (job.finishedAt === null || job.finishedAt === prevFinishedAt) return; // still running/idle, or already reported

    if (job.status === 'done') {
      const text = job.error ? `Cache mover finished with errors: ${job.error}` : 'Cache mover finished moving everything off cache';
      this.activity.log(text, job.error ? 'amber' : 'green', 'cacheMoverCompleted').catch(() => {});
      notifyEvent(this.settings, 'cacheMoverCompleted', 'NonRAID: cache mover finished', text);
    } else if (job.status === 'failed') {
      const text = `Cache mover failed: ${job.error ?? 'unknown error'}`;
      this.activity.log(text, 'red', 'cacheMoverFailed').catch(() => {});
      notifyEvent(this.settings, 'cacheMoverFailed', 'NonRAID: cache mover failed', text);
    }
  }

  private async tick(): Promise<void> {
    this.checkJobCompletion();

    const settings = await this.settings.get();
    const schedule = settings.cacheSchedule;
    if (!schedule.enabled) return;

    const now = new Date();
    if (!scheduleMatchesHour(schedule, now)) return;

    const dateKey = now.toISOString().slice(0, 10);
    if (this.lastFiredDateKey === dateKey) return;
    this.lastFiredDateKey = dateKey;

    if (this.mover.status().status === 'running' || this.mover.status().status === 'planning') return;

    let status;
    try {
      status = await this.nmd.getStatus();
    } catch {
      return; // driver unreachable this tick - try again next time
    }
    if (status.array.state !== 'STARTED' || status.resync.active) return;

    try {
      await this.mover.run();
      this.activity.log('Cache mover started automatically (scheduled)', 'blue').catch(() => {});
    } catch (err) {
      // Same event type as checkJobCompletion()'s own 'failed' branch above - from an admin's
      // perspective "the scheduled mover never started" and "it started then failed" are the same
      // problem (the cache isn't draining to the array as expected), not two things to tell apart.
      const msg = `Scheduled cache mover failed to start: ${(err as Error).message}`;
      this.activity.log(msg, 'red', 'cacheMoverFailed').catch(() => {});
      notifyEvent(this.settings, 'cacheMoverFailed', 'NonRAID: cache mover failed', msg);
    }
  }
}
