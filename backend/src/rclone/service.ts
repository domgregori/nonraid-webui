import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ActivityStore } from '../activity/index.js';
import { config } from '../config.js';
import type { NmdClient } from '../nmd/index.js';
import type { SettingsStore } from '../settings/index.js';
import { notifyEvent } from '../settings/notify.js';
import { resolveConfigBackupPaths } from '../system/backupCatalog.js';
import { writeConfigBackupToFile } from '../system/backupStream.js';
import type { RcloneClient } from './client.js';
import { getRcloneRcCredentials } from './rcCredentials.js';
import { SyncJobStore, type NewSyncJob, type SyncJobPatch } from './syncJobStore.js';
import type { SyncJob, SyncJobProgress, SyncJobWithRuntime } from './types.js';

const ARCHIVE_PREFIX = 'nonraid-remote-backup-';
const ARCHIVE_SUFFIX = '.tar.gz';
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
 * - 'config' / 'configAppdata': not a live mirror - each run builds one fresh tar.gz (same
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
        stagingDir = path.join(os.tmpdir(), `nonraid-rclone-${job.id}-${Date.now()}`);
        await mkdir(stagingDir, { recursive: true });
        const paths = await resolveConfigBackupPaths(this.nmd, job.scope === 'configAppdata');
        if (paths.length === 0) throw new Error('No config files found to back up.');
        const archivePath = path.join(stagingDir, `${ARCHIVE_PREFIX}${Date.now()}${ARCHIVE_SUFFIX}`);
        await writeConfigBackupToFile(paths, archivePath);
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
    const archives = entries.filter((e) => e.Name.startsWith(ARCHIVE_PREFIX) && e.Name.endsWith(ARCHIVE_SUFFIX));
    for (const entry of archives) {
      if (new Date(entry.ModTime).getTime() < cutoff) {
        await this.deleteRemoteFile(remoteFs, entry.Path);
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
