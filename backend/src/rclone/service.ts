import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ActivityStore } from '../activity/index.js';
import { config } from '../config.js';
import type { NmdClient } from '../nmd/index.js';
import type { SettingsStore } from '../settings/index.js';
import { notifyEvent } from '../settings/notify.js';
import { ARCHIVE_EXT, isOwnArchiveName, resolveConfigBackupPaths, resolveExistingCategoryIds } from '../system/backupCatalog.js';
import { buildMeta, META_SUFFIX, metaNameFor, readMetaSidecar, writeMetaSidecar } from '../system/backupMeta.js';
import { writeConfigBackupToFile } from '../system/backupStream.js';
import { buildRestorePreview, decryptIfNeeded, stageRestoreFile, type RestorePreviewData } from '../system/configRestore.js';
import type { RcloneClient } from './client.js';
import { getRcloneRcCredentials } from './rcCredentials.js';
import { SyncJobStore, type NewSyncJob, type SyncJobPatch } from './syncJobStore.js';
import type { RemoteBackupEntry, SyncJob, SyncJobProgress, SyncJobWithRuntime } from './types.js';

const ARCHIVE_PREFIX = 'nonraid-remote-backup-';
const VERSIONS_SUBDIR = '.nonraid-versions'; // rclone --backup-dir target under a 'custom'-scope job's own remote path

function dstFs(remoteName: string, remotePath: string): string {
  const trimmed = remotePath.replace(/^\/+/, '');
  return trimmed ? `${remoteName}:${trimmed}` : `${remoteName}:`;
}

/**
 * Everything the Remote Backup feature actually *does*, beyond the thin RC HTTP calls in
 * RcloneClient - runs one sync job at a time (same single-flight lock as
 * lxc/storagePath.ts's migrateLxcStorage), builds the right rclone source/destination for each of
 * the three sync scopes, and enforces each scope's own retention model. See SyncJob's own doc
 * comment (rclone/types.ts) and RemoteBackupSection.tsx for the scope/retention split this
 * implements:
 *
 * - 'config' / 'configAppdata': not a live mirror - each run builds one fresh archive (same
 *   category-path builder Local Backups itself uses, `configAppdata` just also includes
 *   config.appsBindRoots - see backupCatalog.ts's resolveBackupCategories) and uploads that one
 *   uniquely-timestamped file.
 * - 'custom': a genuine live mirror of an arbitrary local path via rclone `sync/sync`, with
 *   `--backup-dir` (rclone's own changed/deleted-file versioning) pointed at a fixed
 *   `.nonraid-versions/` subpath under the job's own remote path.
 *
 * Retention is day-based across all three scopes, uniformly (SyncJobRetention.keepDays) - not a
 * "keep last N" count. 'custom' prunes its `.nonraid-versions/` entries older than N days, the
 * literal --backup-dir model. 'config'/'configAppdata' have nothing to version in the first place
 * (every run's archive is a brand new uniquely-named file, never an overwrite of a prior one), so
 * "day-based" there means deleting archives whose own age exceeds N days instead - same cutoff
 * policy, applied directly to each archive rather than to a separate versions subpath. See
 * enforceRetention() below.
 */
export class RcloneService {
  readonly store: SyncJobStore;
  private running: { syncJobId: string; rcloneJobId: number; startedAt: number } | null = null;

  constructor(
    private client: RcloneClient,
    private nmd: NmdClient,
    private activity: ActivityStore,
    private settings: SettingsStore,
    store?: SyncJobStore,
  ) {
    this.store = store ?? new SyncJobStore();
  }

  listJobs(): Promise<SyncJob[]> {
    return this.store.list();
  }

  createJob(job: NewSyncJob): Promise<SyncJob> {
    return this.store.create(job);
  }

  updateJob(id: string, patch: SyncJobPatch): Promise<SyncJob> {
    return this.store.update(id, patch);
  }

  deleteJob(id: string): Promise<void> {
    if (this.running?.syncJobId === id) {
      throw new Error('This sync is currently running - cancel it first.');
    }
    return this.store.delete(id);
  }

  /** GET /rclone/jobs' actual payload - each persisted job plus its current runtime state and
   *  (when it's the one currently syncing) live progress from rclone's own core/stats. */
  async listJobsWithRuntime(): Promise<SyncJobWithRuntime[]> {
    const jobs = await this.store.list();
    const results: SyncJobWithRuntime[] = [];
    for (const job of jobs) {
      if (this.running?.syncJobId === job.id) {
        const progress = await this.readProgress(this.running.rcloneJobId).catch(() => null);
        results.push({ ...job, state: 'syncing', progress });
      } else {
        results.push({ ...job, state: job.enabled ? 'idle' : 'disabled', progress: null });
      }
    }
    return results;
  }

  private async readProgress(rcloneJobId: number): Promise<SyncJobProgress> {
    const stats = await this.client.coreStats(`job/${rcloneJobId}`);
    const transferring = stats.transferring?.[0];
    return {
      bytes: stats.bytes,
      totalBytes: stats.totalBytes,
      speedBytesPerSec: stats.speed,
      etaSeconds: stats.eta,
      filesDone: stats.transfers,
      filesTotal: stats.totalTransfers,
      transferringName: transferring?.name ?? null,
    };
  }

  async cancelCurrent(): Promise<void> {
    if (!this.running) throw new Error('No sync is currently running.');
    await this.client.stopJob(this.running.rcloneJobId);
  }

  /** Archives sitting at an arbitrary remote+path - the actual listing logic behind both
   *  listJobBackups() (a job's own fixed target) and the onboarding disaster-recovery flow's
   *  browse-backups route (a remote+path picked fresh, with no job record behind it at all, since
   *  a from-scratch install has no sync jobs yet). Each entry is enriched with its own
   *  `.meta.json` sidecar's `encrypted`/`categories` fields when one exists next to it remotely
   *  (downloaded and read directly, one small `operations/copyfile` per entry - these are
   *  plaintext JSON files a few hundred bytes each, never the archive itself) - missing sidecar
   *  reads as unencrypted/unknown, same rule as the local list (backupMeta.ts's own doc comment). */
  async listBackupsAt(remoteName: string, remotePath: string): Promise<RemoteBackupEntry[]> {
    const dst = dstFs(remoteName, remotePath);
    const entries = await this.client.listDir(dst).catch(() => []);
    const archiveEntries = entries.filter((e) => isOwnArchiveName(e.name, ARCHIVE_PREFIX));
    const metaNames = new Set(entries.filter((e) => e.name.endsWith(META_SUFFIX)).map((e) => e.name));

    const results = await Promise.all(
      archiveEntries.map(async (e): Promise<RemoteBackupEntry> => {
        const metaName = metaNameFor(e.name);
        if (!metaNames.has(metaName)) return { name: e.name, sizeBytes: e.sizeBytes, modTime: e.modTime, encrypted: false, categories: null };
        try {
          const raw = await this.client.readFileText(dst, metaName);
          const meta = JSON.parse(raw) as { encrypted?: boolean; categories?: RemoteBackupEntry['categories'] };
          return { name: e.name, sizeBytes: e.sizeBytes, modTime: e.modTime, encrypted: !!meta.encrypted, categories: meta.categories ?? null };
        } catch {
          return { name: e.name, sizeBytes: e.sizeBytes, modTime: e.modTime, encrypted: false, categories: null };
        }
      }),
    );
    return results.sort((a, b) => b.modTime.localeCompare(a.modTime));
  }

  /** Archives one of this job's own past runs has already uploaded to its remote target, for the
   *  Recovery hub's "restore from a remote backup" picker. Only 'config'/'configAppdata' scope
   *  jobs produce these - a 'custom' scope job mirrors an arbitrary folder live, with nothing
   *  resembling a single restorable archive sitting at its target path. Thin wrapper around
   *  listBackupsAt() - see its own doc comment for the actual listing logic. */
  async listJobBackups(id: string): Promise<RemoteBackupEntry[]> {
    const job = await this.store.get(id);
    if (!job) throw new Error('Sync job not found.');
    if (job.scope === 'custom') {
      throw new Error("This sync job mirrors a folder directly - it doesn't produce a single config backup archive to restore from.");
    }
    return this.listBackupsAt(job.remoteName, job.remotePath);
  }

  /**
   * Downloads one of listBackupsAt()'s own archives (at an arbitrary remote+path) into a private
   * staging path and builds the exact same restore preview / staged token the upload and
   * local-backup flows produce - everything from here on (reviewing categories, committing) is
   * the same POST /system/backup/backup/restore/commit every other source already feeds into, no
   * separate remote-specific commit path needed. Its own `.meta.json` sidecar (if any) is pulled
   * down alongside it to decide whether a password is required - see decryptIfNeeded()'s own doc
   * comment (configRestore.ts) for why that decrypt stage runs here, ahead of
   * buildRestorePreview(), rather than inside it. `stagingKey` only picks the staging directory's
   * own name (a job id for the by-job caller, an arbitrary tag for the path-based one) - it has no
   * bearing on where the archive itself is read from.
   */
  async previewBackupAt(remoteName: string, remotePath: string, name: string, password: string | null | undefined, stagingKey: string): Promise<{ token: string } & RestorePreviewData> {
    if (!isOwnArchiveName(name, ARCHIVE_PREFIX) || name.includes('/') || name.includes('\\')) {
      throw new Error('Invalid archive name.');
    }
    const stagingDir = path.join(os.tmpdir(), `nonraid-rclone-restore-${stagingKey}-${Date.now()}`);
    await mkdir(stagingDir, { recursive: true });
    let cleanupDecrypted = async () => {};
    try {
      const dst = dstFs(remoteName, remotePath);
      await this.client.downloadFile(dst, name, stagingDir, name);
      const filePath = path.join(stagingDir, name);
      const metaName = metaNameFor(name);
      await this.client.downloadFile(dst, metaName, stagingDir, metaName).catch(() => {}); // best-effort - no sidecar reads as unencrypted
      const meta = await readMetaSidecar(filePath); // reads stagingDir/<metaName>, same naming as the just-downloaded file above

      const { path: decryptedPath, cleanup } = await decryptIfNeeded(filePath, meta?.encrypted ?? false, password);
      cleanupDecrypted = cleanup;
      const preview = await buildRestorePreview(this.nmd, decryptedPath);
      const token = randomUUID();
      stageRestoreFile(token, decryptedPath);
      // Once decryption actually happened, the staged plaintext copy above lives outside
      // stagingDir (decryptFileToTemp's own private tmp file) - the original ciphertext archive +
      // sidecar left in stagingDir are no longer needed, so they're cleaned up now instead of
      // accumulating. Left in place when nothing was encrypted (decryptedPath === filePath, still
      // inside stagingDir) - same "cleaned up on error, kept until commit/expiry on success"
      // precedent this staging dir already had before encryption existed.
      if (decryptedPath !== filePath) {
        await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      }
      return { token, ...preview };
    } catch (err) {
      await cleanupDecrypted();
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  }

  /** Thin wrapper around previewBackupAt() for one of this job's own archives - see its own doc
   *  comment for the actual download/decrypt/preview logic. */
  async previewJobBackup(id: string, name: string, password?: string | null): Promise<{ token: string } & RestorePreviewData> {
    const job = await this.store.get(id);
    if (!job) throw new Error('Sync job not found.');
    if (job.scope === 'custom') {
      throw new Error("This sync job mirrors a folder directly - it doesn't produce a single config backup archive to restore from.");
    }
    return this.previewBackupAt(job.remoteName, job.remotePath, name, password, job.id);
  }

  /** The actual sync+retention work, shared by RcloneSyncScheduler's ticker and the manual "Sync
   *  now" route - see class doc comment above for what each scope actually does. */
  async runJobNow(id: string, label = 'Manual sync'): Promise<void> {
    if (this.running) {
      throw new Error('Another sync is already running - wait for it to finish first, or cancel it.');
    }
    const job = await this.store.get(id);
    if (!job) throw new Error('Sync job not found.');
    if (!job.enabled) throw new Error('This sync job is disabled - enable it first.');

    const remotes = await this.client.listRemotes();
    if (!remotes.some((r) => r.name === job.remoteName)) {
      throw new Error(`Remote "${job.remoteName}" isn't configured - add it above first.`);
    }

    let stagingDir: string | null = null;
    try {
      let srcFs: string;
      let mode: 'copy' | 'sync';
      let backupDir: string | undefined;

      if (job.scope === 'custom') {
        if (!job.customPath.trim()) throw new Error('No custom path configured for this sync job.');
        srcFs = job.customPath;
        mode = 'sync';
        if (!job.retention.forever) backupDir = dstFs(job.remoteName, path.posix.join(job.remotePath, VERSIONS_SUBDIR));
      } else {
        // A saved password but encryption switched off is left alone (not cleared - see
        // BackupEncryption's own doc comment, settings/types.ts), so this only ever reveals it
        // when actually needed.
        let password: string | undefined;
        if (job.encryption.enabled) {
          if (!job.encryption.passwordObscured) throw new Error('Encryption is on but no password is saved - edit this sync and set one.');
          password = await this.client.reveal(job.encryption.passwordObscured);
        }

        stagingDir = path.join(os.tmpdir(), `nonraid-rclone-${job.id}-${Date.now()}`);
        await mkdir(stagingDir, { recursive: true });
        const includeAppdata = job.scope === 'configAppdata';
        const paths = await resolveConfigBackupPaths(this.nmd, includeAppdata);
        if (paths.length === 0) throw new Error('No config files found to back up.');
        const archivePath = path.join(stagingDir, `${ARCHIVE_PREFIX}${Date.now()}${ARCHIVE_EXT}`);
        await writeConfigBackupToFile(paths, archivePath, password);
        // Written into the same stagingDir as the archive itself, so it rides along on the exact
        // same rclone copy below - no separate upload call needed (see backupMeta.ts's own doc
        // comment on this module's split between "build the sidecar" and "get it to the
        // destination", which for this scope is just "put it next to the archive before syncing").
        const categories = await resolveExistingCategoryIds(this.nmd, includeAppdata);
        await writeMetaSidecar(archivePath, buildMeta(job.scope, categories, !!password));
        srcFs = stagingDir;
        mode = 'copy';
      }

      this.activity.log(`${label} started (${job.name})`, 'blue').catch(() => {});
      const { jobId: rcloneJobId } = await this.client.startSync({ srcFs, dstFs: dstFs(job.remoteName, job.remotePath), mode, backupDir });
      this.running = { syncJobId: job.id, rcloneJobId, startedAt: Date.now() };

      const status = await this.pollUntilDone(rcloneJobId);
      const stats = await this.client.coreStats(`job/${rcloneJobId}`).catch(() => null);

      if (!status.success) {
        throw new Error(status.error || 'rclone sync failed.');
      }

      await this.store.update(job.id, {
        lastSyncedAt: Date.now(),
        lastSizeBytes: stats?.bytes ?? null,
        lastFileCount: stats?.transfers ?? null,
        lastErrorCount: stats?.errors ?? 0,
        lastError: null,
      });

      if (!job.retention.forever) {
        await this.enforceRetention(job).catch((err) => {
          this.activity.log(`${job.name}: retention cleanup failed - ${(err as Error).message}`, 'amber').catch(() => {});
        });
      }

      const completedText = `${label} completed (${job.name})`;
      this.activity.log(completedText, 'blue', 'backupCompleted').catch(() => {});
      notifyEvent(this.settings, 'backupCompleted', 'NonRAID: remote sync completed', completedText);
    } catch (err) {
      const message = (err as Error).message;
      await this.store.update(job.id, { lastError: message }).catch(() => {});
      const failedText = `${label} failed (${job.name}): ${message}`;
      this.activity.log(failedText, 'red', 'backupFailed').catch(() => {});
      notifyEvent(this.settings, 'backupFailed', 'NonRAID: remote sync failed', failedText);
      throw err;
    } finally {
      this.running = null;
      if (stagingDir) await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async pollUntilDone(rcloneJobId: number): Promise<{ success: boolean; error: string }> {
    for (;;) {
      const status = await this.client.jobStatus(rcloneJobId);
      if (status.finished) return status;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }

  /** Day-based across every scope (retention.keepDays) - see class doc comment for why 'custom'
   *  and 'config'/'configAppdata' apply the same cutoff to two different kinds of entries. */
  private async enforceRetention(job: SyncJob): Promise<void> {
    const cutoff = Date.now() - job.retention.keepDays * 24 * 60 * 60 * 1000;
    if (job.scope === 'custom') {
      const versionsFs = dstFs(job.remoteName, path.posix.join(job.remotePath, VERSIONS_SUBDIR));
      const entries = await this.listRemoteFiles(versionsFs);
      for (const entry of entries) {
        if (new Date(entry.ModTime).getTime() < cutoff) {
          await this.deleteRemoteFile(versionsFs, entry.Path);
        }
      }
      return;
    }
    const remoteFs = dstFs(job.remoteName, job.remotePath);
    const entries = await this.listRemoteFiles(remoteFs);
    const archives = entries.filter((e) => isOwnArchiveName(e.Name, ARCHIVE_PREFIX));
    for (const entry of archives) {
      if (new Date(entry.ModTime).getTime() < cutoff) {
        await this.deleteRemoteFile(remoteFs, entry.Path);
        // Best-effort - a sidecar that's already gone (or never existed, a legacy pre-feature
        // archive) 404s from rclone and isn't a failure worth aborting the rest of this prune over.
        await this.deleteRemoteFile(remoteFs, metaNameFor(entry.Path)).catch(() => {});
      }
    }
  }

  private async listRemoteFiles(fs: string): Promise<{ Path: string; Name: string; ModTime: string }[]> {
    return rcListDir(fs);
  }

  private async deleteRemoteFile(fs: string, remotePath: string): Promise<void> {
    await rcDeleteFile(fs, remotePath);
  }
}

// operations/list and operations/deletefile aren't part of RcloneClient's own interface (they're
// only ever needed for this service's own retention pruning, not the settings/remotes UI the
// client interface otherwise serves) - called directly here via the same rcCall helper shape
// realClient.ts uses, rather than widening RcloneClient with retention-specific methods nothing
// else would ever call.
async function rcRawCall<T>(rcPath: string, body: Record<string, unknown>): Promise<T> {
  const creds = await getRcloneRcCredentials();
  if (!creds) throw new Error("Remote Backup's rclone-rcd credentials aren't available.");
  const auth = Buffer.from(`${creds.user}:${creds.pass}`).toString('base64');
  const res = await fetch(`${config.rcloneRcUrl}/${rcPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Basic ${auth}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.rcloneRcTimeoutMs),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
  if (!res.ok) throw new Error(json?.error || `rclone rcd ${rcPath} failed: HTTP ${res.status}`);
  return json as T;
}

async function rcListDir(fs: string): Promise<{ Path: string; Name: string; ModTime: string }[]> {
  try {
    const result = await rcRawCall<{ list: { Path: string; Name: string; ModTime: string; IsDir: boolean }[] }>('operations/list', { fs, remote: '' });
    return result.list.filter((e) => !e.IsDir);
  } catch {
    // A remote path that doesn't exist yet (nothing's ever been synced there) is not an error for
    // retention purposes - just nothing to prune.
    return [];
  }
}

async function rcDeleteFile(fs: string, remotePath: string): Promise<void> {
  await rcRawCall('operations/deletefile', { fs, remote: remotePath });
}
