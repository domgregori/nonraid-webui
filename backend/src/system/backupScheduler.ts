import { access, constants, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { ActivityStore } from '../activity/index.js';
import { config } from '../config.js';
import type { MetricsService } from '../metrics/service.js';
import type { NmdClient } from '../nmd/index.js';
import type { RcloneClient } from '../rclone/client.js';
import type { SettingsStore } from '../settings/index.js';
import { notifyEvent } from '../settings/notify.js';
import { scheduleFireKey, scheduleMatches } from '../settings/scheduleMatch.js';
import type { BackupCategoryId } from './backupCatalog.js';
import { resolveConfigBackupPaths, resolveExistingCategoryIds } from './backupCatalog.js';
import { resolveBackupDestDir } from './backupDestination.js';
import { buildMeta, deleteMetaSidecar, readMetaSidecar, writeMetaSidecar } from './backupMeta.js';
import { writeConfigBackupToFile } from './backupStream.js';

const BACKUP_PREFIX = 'nonraid-config-backup-';
const BACKUP_SUFFIX = '.tar.gz';

// GET /system/backup/local/list - one archive at Settings -> Local Backups' own configured
// destination, enriched with its own `.meta.json` sidecar (backupMeta.ts) when one exists next to
// it. `encrypted: false, categories: null` for an archive with no sidecar at all - reads as
// "legacy, made before this feature shipped", never an error (see backupMeta.ts's own doc
// comment). Mirrors rclone/types.ts's RemoteBackupEntry, the same shape for the remote picker.
export interface LocalBackupEntry {
  name: string;
  sizeBytes: number;
  modifiedAt: number;
  encrypted: boolean;
  categories: BackupCategoryId[] | null;
}

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
    // Only ever used to reveal() an already-obscured saved password right before an encrypted
    // run needs the real plaintext for openssl - see BackupEncryption's own doc comment
    // (settings/types.ts). Not used for anything else Local Backups does.
    private rclone: RcloneClient,
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
      // A saved password but encryption switched off is left alone (not cleared - see
      // BackupEncryption's own doc comment), so this only ever reveals it when actually needed.
      let password: string | undefined;
      if (schedule.encryption.enabled) {
        if (!schedule.encryption.passwordObscured) {
          const msg = `${label} skipped - encryption is on but no password is saved`;
          this.activity.log(msg, 'amber').catch(() => {});
          throw new Error('Encryption is on but no password is saved - set one in Settings → Local Backups.');
        }
        password = await this.rclone.reveal(schedule.encryption.passwordObscured);
      }

      this.metrics.checkpointForBackup();
      const includeAppdata = schedule.scope === 'configAppdata';
      const paths = await resolveConfigBackupPaths(this.nmd, includeAppdata);
      if (paths.length === 0) {
        const msg = `${label} skipped - no config files found to back up`;
        this.activity.log(msg, 'amber').catch(() => {});
        throw new Error('No config files found to back up.');
      }
      const destPath = path.join(destDir, `${BACKUP_PREFIX}${Date.now()}${BACKUP_SUFFIX}`);
      const bytes = await writeConfigBackupToFile(paths, destPath, password);
      const categories = await resolveExistingCategoryIds(this.nmd, includeAppdata);
      await writeMetaSidecar(destPath, buildMeta(schedule.scope, categories, !!password));
      const sizeLabel = bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
      const completedText = `${label} completed (${sizeLabel}${password ? ', encrypted' : ''})`;
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
      await deleteMetaSidecar(full);
    }
    if (toDelete.length > 0) {
      this.activity.log(`Pruned ${toDelete.length} old backup${toDelete.length === 1 ? '' : 's'}`, 'blue').catch(() => {});
    }
  }

  /**
   * What's already sitting at the configured destination, for the Recovery hub's "restore from a
   * local backup" picker - identified by this scheduler's own filename prefix, same as prune()
   * above. `destDir: null` covers both "nothing saved yet" and a destination picker that can't
   * resolve without more configuration (the 'array' mode with no disk slot chosen) - either way
   * there's nothing to list, not an error worth failing the request over.
   */
  async listBackups(): Promise<{ destDir: string | null; backups: LocalBackupEntry[] }> {
    const settings = await this.settings.get();
    let destDir: string;
    try {
      destDir = resolveBackupDestDir(settings.backupSchedule.destination);
    } catch {
      return { destDir: null, backups: [] };
    }
    if (!destDir) return { destDir: null, backups: [] };

    let entries: string[];
    try {
      entries = await readdir(destDir);
    } catch {
      return { destDir, backups: [] };
    }
    const ours = entries.filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith(BACKUP_SUFFIX));
    const withStats = await Promise.all(
      ours.map(async (f) => {
        const full = path.join(destDir, f);
        try {
          const st = await stat(full);
          const meta = await readMetaSidecar(full);
          return { name: f, sizeBytes: st.size, modifiedAt: st.mtimeMs, encrypted: meta?.encrypted ?? false, categories: meta?.categories ?? null };
        } catch {
          return null;
        }
      }),
    );
    const backups = withStats.filter((e): e is LocalBackupEntry => e !== null).sort((a, b) => b.modifiedAt - a.modifiedAt);
    return { destDir, backups };
  }

  /** Resolves one of listBackups()'s own filenames back to its absolute path on disk, scoped
   *  strictly to the configured destination directory - defense against a crafted name walking
   *  outside it (e.g. "../../etc/passwd") the way resolveRootPath() guards array.ts's own
   *  path-based import. Throws if the name doesn't look like one of this scheduler's own archives
   *  or the file no longer actually exists (e.g. pruned between listing and picking it). */
  async resolveBackupPath(name: string): Promise<string> {
    if (!name.startsWith(BACKUP_PREFIX) || !name.endsWith(BACKUP_SUFFIX) || name.includes('/') || name.includes('\\')) {
      throw new Error('Invalid backup file name.');
    }
    const settings = await this.settings.get();
    const destDir = resolveBackupDestDir(settings.backupSchedule.destination);
    const full = path.join(destDir, name);
    await stat(full); // throws (and propagates) if it no longer exists
    return full;
  }
}
