import type { BackupCategoryId } from '../system/backupCatalog.js';
import type { BackupEncryption, RecurringSchedule } from '../settings/types.js';

// One field in a provider's own config schema, as reported live by rclone's `config/providers` RC
// call (confirmed live against rclone v1.75.0 on the test rig - this is a real RC call, not just a
// CLI-only subcommand, see rclone/realClient.ts's listProviders()). Only the subset this app's own
// dynamic Add-remote form actually uses - rclone's own response has several more fields
// (Exclusive/Sensitive/Hide/...) nothing here reads.
export interface RcloneProviderOption {
  name: string;
  help: string;
  default: string;
  required: boolean;
  isPassword: boolean;
  type: string; // 'string' | 'bool' | 'int' | 'SizeSuffix' | ... - rendered as a plain text input for
  // anything other than 'bool' (a checkbox); good enough for the providers this app's own install
  // targets (S3-compatible, B2, Drive, SFTP, WebDAV, Dropbox, ...), all of which are simple scalars.
}

export interface RcloneProvider {
  name: string; // e.g. "b2" - what gets sent as `type` to config/create
  description: string; // e.g. "Backblaze B2" - shown in the provider picker
  // Only the non-advanced options - rclone's own provider schemas include many more advanced/
  // power-user fields (chunk sizes, custom endpoints, ...) that would turn this app's simple
  // Add-remote form into the same generic "every rclone option" UI the rclone-web reference app
  // has; this app deliberately shows only what's needed to get a working remote, matching the
  // mockup's 2-4 field forms.
  options: RcloneProviderOption[];
}

// A configured remote, as reported live by config/listremotes + config/dump - rclone's own
// config file/rcd instance is the sole source of truth (no local copy of remote definitions is
// persisted by this app, same "don't shadow an external source of truth" reasoning as
// TailscaleSettings vs. live `tailscale status`).
export interface RcloneRemote {
  name: string;
  type: string; // provider name, e.g. "b2"
  status: 'ok' | 'authExpired' | 'error' | 'unknown';
  statusMessage: string | null;
}

export interface RcloneDaemonStatus {
  installed: boolean; // the `rclone` binary is on PATH
  running: boolean; // rcd answered a live RC call just now
  featureEnabled: boolean; // settings.remoteBackup.enabled
}

// Mirrors BackupScope plus a third 'custom' option - a sync job can point at an arbitrary path,
// unlike Local Backups (which only ever writes into its own destination folder).
export type SyncScope = 'config' | 'configAppdata' | 'custom';

export interface SyncJobRetention {
  // Day-based, uniformly across every scope - not a "keep last N" count. 'custom' (a live mirror)
  // maps this straight onto rclone's own --backup-dir versioning (changed/deleted files moved
  // there instead of deleted, then pruned once older than keepDays); 'config'/'configAppdata'
  // (each run uploads one fresh uniquely-named archive, so there's nothing to overwrite/version)
  // apply the same keepDays cutoff directly to each archive's own age instead. Deliberately the
  // same field/label/UI for every scope - see RcloneService.enforceRetention()'s doc comment for
  // why this used to be split by scope and isn't anymore. This is Remote Backup's own retention
  // model only; Local Backups' separate BackupSchedule.retain/retainForever (count-based) is
  // unrelated and unaffected.
  keepDays: number;
  forever: boolean; // overrides keepDays - never prune/expire anything
}

// A user-defined sync job - this app's own record, not something rclone itself knows about (rclone
// only knows remotes + ad hoc transfers). Persisted in syncJobStore.ts; scheduled by
// syncScheduler.ts; run through RcloneClient.startSync().
export interface SyncJob {
  id: string;
  name: string;
  enabled: boolean;
  scope: SyncScope;
  customPath: string; // meaningful only when scope === 'custom'
  remoteName: string; // which configured remote (RcloneRemote.name) this job syncs to
  remotePath: string; // subpath under the remote, e.g. "my-bucket/nonraid-backups" - rclone destinations
  // are "remote:path", and the path half (bucket, subfolder, ...) varies per remote/provider, so
  // it's kept here rather than baked into the remote definition itself.
  schedule: RecurringSchedule;
  retention: SyncJobRetention;
  // Per-job password encryption (openssl enc) for this job's own uploaded archive - see
  // BackupEncryption's own doc comment (settings/types.ts). Only meaningful for 'config'/
  // 'configAppdata' scope (each run uploads one discrete archive); a 'custom' scope job mirrors an
  // arbitrary folder file-by-file via rclone sync/sync, which is a fundamentally different problem
  // ("encrypt every synced file individually", rclone's own crypt backend territory) this feature
  // deliberately doesn't take on - the UI never offers this toggle for a 'custom' scope job.
  encryption: BackupEncryption;
  // Last-run summary - persisted so it survives a backend restart, shown on the job card's resting
  // stats line. null until the job has completed at least one run.
  lastSyncedAt: number | null;
  lastSizeBytes: number | null;
  lastFileCount: number | null;
  lastErrorCount: number | null;
  lastError: string | null;
}

// Live progress for whichever sync job is currently running - never persisted, computed on demand
// from rclone's own core/stats (scoped to this job's rclone jobid via the `group` param) each time
// GET /rclone/jobs is polled while a job is mid-sync.
export interface SyncJobProgress {
  bytes: number;
  totalBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number | null;
  filesDone: number;
  filesTotal: number;
  transferringName: string | null;
}

export type SyncJobRuntimeState = 'idle' | 'syncing' | 'disabled';

export interface SyncJobWithRuntime extends SyncJob {
  state: SyncJobRuntimeState;
  progress: SyncJobProgress | null; // set only when state === 'syncing'
}

// One non-directory entry from rclone's own `operations/list` - the subset RcloneClient.listDir()
// actually reads, used both by RcloneService's own retention pruning (a private, narrower call
// shape - see service.ts's rcListDir) and the Recovery hub's "restore from a remote backup" file
// picker (GET /rclone/jobs/:id/backups, which filters this down to just the job's own archives).
export interface RcloneDirEntry {
  name: string;
  path: string;
  sizeBytes: number;
  modTime: string; // ISO 8601, straight from rclone
}

// GET /rclone/jobs/:id/backups - one archive a 'config'/'configAppdata' scope job has already
// uploaded, enriched with its own `.meta.json` sidecar (backupMeta.ts) when one exists next to it
// remotely. `encrypted: false, categories: null` for an archive with no sidecar at all - reads the
// same as "legacy, made before this feature shipped" everywhere, never an error (see
// backupMeta.ts's readMetaSidecar doc comment for the local equivalent of this same rule).
export interface RemoteBackupEntry {
  name: string;
  sizeBytes: number;
  modTime: string;
  encrypted: boolean;
  categories: BackupCategoryId[] | null;
}
