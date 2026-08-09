import { access, constants, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { ActivityStore } from '../activity/index.js';
import { config } from '../config.js';
import type { NmdClient } from '../nmd/index.js';
import type { SettingsStore } from '../settings/index.js';
import { notifyEvent } from '../settings/notify.js';
import { scheduleMatchesHour } from '../settings/scheduleMatch.js';
import { resolveConfigBackupPaths, writeConfigBackupToFile } from './backupStream.js';

const BACKUP_PREFIX = 'nonraid-config-backup-';
const BACKUP_SUFFIX = '.tar.gz';

/**
 * Writes an unattended config backup at the configured weekly/monthly day/hour, in the server's
 * own local time. Same self-unref'd ticker shape as ParityScheduler, sharing its day/hour match
 * logic (settings/scheduleMatch.ts). Prunes older backups down to the configured retain count
 * after each successful run — this is a background job nobody's watching, so it must not be left
 * to slowly fill the destination disk on its own.
 *
 * Same lastFiredDateKey caveat as ParityScheduler: in-memory only, so a backend restart during the
 * scheduled hour could refire that same day.
 */
export class BackupScheduler {
  private timer: NodeJS.Timeout;
  private lastFiredDateKey: string | null = null;

  constructor(
    private nmd: NmdClient,
    private settings: SettingsStore,
    private activity: ActivityStore,
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
    if (!scheduleMatchesHour(schedule, now)) return;

    const dateKey = now.toISOString().slice(0, 10);
    if (this.lastFiredDateKey === dateKey) return;
    this.lastFiredDateKey = dateKey;

    if (!schedule.destDir) {
      this.activity.log('Scheduled backup skipped — no destination directory configured', 'amber').catch(() => {});
      return;
    }
    try {
      await access(schedule.destDir, constants.W_OK);
    } catch {
      this.activity.log(`Scheduled backup skipped — destination "${schedule.destDir}" doesn't exist or isn't writable`, 'amber').catch(() => {});
      return;
    }

    try {
      const paths = await resolveConfigBackupPaths(this.nmd);
      if (paths.length === 0) {
        this.activity.log('Scheduled backup skipped — no config files found to back up', 'amber').catch(() => {});
        return;
      }
      const destPath = path.join(schedule.destDir, `${BACKUP_PREFIX}${Date.now()}${BACKUP_SUFFIX}`);
      const bytes = await writeConfigBackupToFile(paths, config.systemUseSudo, destPath);
      const sizeLabel = bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
      const completedText = `Scheduled backup completed (${sizeLabel})`;
      this.activity.log(completedText, 'blue').catch(() => {});
      notifyEvent(this.settings, 'backupCompleted', 'NonRAID: scheduled backup completed', completedText);
      await this.prune(schedule.destDir, schedule.retain);
    } catch (err) {
      const failedText = `Scheduled backup failed: ${(err as Error).message}`;
      this.activity.log(failedText, 'red').catch(() => {});
      notifyEvent(this.settings, 'backupFailed', 'NonRAID: scheduled backup failed', failedText);
    }
  }

  /** Deletes the oldest backups in destDir beyond `retain`, identified by this scheduler's own
   *  filename prefix — never touches files it didn't create. */
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
