import { access, constants, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { ActivityStore } from '../activity/index.js';
import { config } from '../config.js';
import type { MetricsService } from '../metrics/service.js';
import type { NmdClient } from '../nmd/index.js';
import type { SettingsStore } from '../settings/index.js';
import { notifyEvent } from '../settings/notify.js';
import { scheduleFireKey, scheduleMatches } from '../settings/scheduleMatch.js';
import { resolveBackupDestDir } from './backupDestination.js';
import { resolveConfigBackupPaths, writeConfigBackupToFile } from './backupStream.js';

const BACKUP_PREFIX = 'nonraid-config-backup-';
const BACKUP_SUFFIX = '.tar.gz';

/**
 * Writes an unattended config backup at the configured weekly/monthly day/hour, in the server's
 * own local time. Same self-unref'd ticker shape as ParityScheduler, sharing its day/hour match
 * logic (settings/scheduleMatch.ts). Prunes older backups down to the configured retain count
 * after each successful run - this is a background job nobody's watching, so it must not be left
 * to slowly fill the destination disk on its own.
 *
 * Same lastFiredDateKey caveat as ParityScheduler: in-memory only, so a backend restart during the
 * scheduled hour could refire that same day.
 */
export class BackupScheduler {
  private timer: NodeJS.Timeout;
  private lastFiredKey: string | null = null;

  constructor(
    private nmd: NmdClient,
    private settings: SettingsStore,
    private activity: ActivityStore,
    private metrics: MetricsService,
    intervalMs: number = config.schedulerTickIntervalMs,
  ) {
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    const settings = await this.settings.get();
    const schedule = settings.backupSchedule;
    if (!schedule.enabled) return;

    const now = new Date();
    if (!scheduleMatches(schedule, now)) return;

    const fireKey = scheduleFireKey(schedule, now);
    if (this.lastFiredKey === fireKey) return;
    this.lastFiredKey = fireKey;

    // runNow() already logs/notifies on every failure path - this is only here so a skip/failure
    // doesn't become an unhandled rejection from the un-awaited setInterval callback in the
    // constructor above.
    await this.runNow('Scheduled backup').catch(() => {});
  }

  /**
   * The actual backup+prune work, shared by the schedule ticker above and the manual "Back up
   * now" route (routes/system.ts) - same destDir/retain from saved settings either way, since a
   * manual run against an unsaved draft destination would back up to a place the next scheduled
   * run (or a later manual run) wouldn't agree on. `label` only changes the activity-log/
   * notification wording ("Scheduled backup" vs "Manual backup") so the two are distinguishable
   * in the log, not the logic.
   */
  async runNow(label = 'Manual backup'): Promise<{ bytes: number }> {
    const settings = await this.settings.get();
    const schedule = settings.backupSchedule;
    let destDir: string;
    try {
      destDir = resolveBackupDestDir(schedule.destination);
    } catch (err) {
      const msg = `${label} skipped - ${(err as Error).message}`;
      this.activity.log(msg, 'amber').catch(() => {});
      throw err;
    }

    if (!destDir) {
      const msg = `${label} skipped - no destination directory configured`;
      this.activity.log(msg, 'amber').catch(() => {});
      throw new Error('No destination directory configured - set one below and save first.');
    }
    // The 'boot'/'array' picker options resolve to a fixed convention path (e.g.
    // /var/lib/nonraid-webui/backups, /mnt/diskN/backups) that may not exist yet on a host that's
    // never backed up there before - create it rather than failing, same as any other
    // first-use-creates-the-folder destination in this app. A 'custom' path is left as-is: an
    // admin-typed path that doesn't exist is more likely a typo worth surfacing than something to
    // silently create.
    if (schedule.destination.mode !== 'custom') {
      await mkdir(destDir, { recursive: true }).catch(() => {});
    }
    try {
      await access(destDir, constants.W_OK);
    } catch {
      const msg = `${label} skipped - destination "${destDir}" doesn't exist or isn't writable`;
      this.activity.log(msg, 'amber').catch(() => {});
      throw new Error(`Destination "${destDir}" doesn't exist or isn't writable.`);
    }

    try {
      this.metrics.checkpointForBackup();
      const paths = await resolveConfigBackupPaths(this.nmd, schedule.scope === 'configAppdata');
      if (paths.length === 0) {
        const msg = `${label} skipped - no config files found to back up`;
        this.activity.log(msg, 'amber').catch(() => {});
        throw new Error('No config files found to back up.');
      }
      const destPath = path.join(destDir, `${BACKUP_PREFIX}${Date.now()}${BACKUP_SUFFIX}`);
      const bytes = await writeConfigBackupToFile(paths, destPath);
      const sizeLabel = bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
      const completedText = `${label} completed (${sizeLabel})`;
      this.activity.log(completedText, 'blue', 'backupCompleted').catch(() => {});
      notifyEvent(this.settings, 'backupCompleted', 'NonRAID: backup completed', completedText);
      if (!schedule.retainForever) {
        await this.prune(destDir, schedule.retain);
      }
      return { bytes };
    } catch (err) {
      const failedText = `${label} failed: ${(err as Error).message}`;
      this.activity.log(failedText, 'red', 'backupFailed').catch(() => {});
      notifyEvent(this.settings, 'backupFailed', 'NonRAID: backup failed', failedText);
      throw err;
    }
  }

  /** Deletes the oldest backups in destDir beyond `retain`, identified by this scheduler's own
   *  filename prefix - never touches files it didn't create. */
  private async prune(destDir: string, retain: number): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(destDir);
    } catch {
      return;
    }
    const ours = entries.filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith(BACKUP_SUFFIX));
    if (ours.length <= retain) return;

    const withMtimes = await Promise.all(
      ours.map(async (f) => {
        const full = path.join(destDir, f);
        try {
          return { full, mtime: (await stat(full)).mtimeMs };
        } catch {
          return null;
        }
      }),
    );
    const sorted = withMtimes.filter((e): e is { full: string; mtime: number } => e !== null).sort((a, b) => a.mtime - b.mtime);
    const toDelete = sorted.slice(0, sorted.length - retain);
    for (const { full } of toDelete) {
      await unlink(full).catch(() => {});
    }
    if (toDelete.length > 0) {
      this.activity.log(`Pruned ${toDelete.length} old backup${toDelete.length === 1 ? '' : 's'}`, 'blue').catch(() => {});
    }
  }
}
