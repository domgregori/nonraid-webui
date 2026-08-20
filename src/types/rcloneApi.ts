// Mirrors backend/src/rclone/types.ts plus routes/rclone.ts's response shapes. Keep in sync.
import type { RecurringSchedule } from './settingsApi';
import type { BackupCategoryId } from './systemApi';

export interface RcloneStatus {
  installed: boolean;
  running: boolean;
  featureEnabled: boolean;
}

export interface RcloneProviderOption {
  name: string;
  help: string;
  default: string;
  required: boolean;
  isPassword: boolean;
  type: string;
}

export interface RcloneProvider {
  name: string;
  description: string;
  options: RcloneProviderOption[];
}

export type RcloneRemoteStatus = 'ok' | 'authExpired' | 'error' | 'unknown';

export interface RcloneRemote {
  name: string;
  type: string;
  status: RcloneRemoteStatus;
  statusMessage: string | null;
}

/** GET /rclone/remotes/:name - a remote's own saved config, used to pre-fill the Edit form.
 *  Password-type fields come back as rclone's own *obscured* value, never the plaintext. */
export interface RcloneRemoteConfig {
  type: string;
  parameters: Record<string, string>;
}

/** Result of POST /rclone/remotes or POST /rclone/remotes/:name/continue - `done: false` means an
 *  OAuth-based provider needs the admin to open `authUrl` in a browser first, then this app calls
 *  continue with the same `state` to finish - same two-step shape as TailscaleStatus's login flow. */
export interface RcloneRemoteSetupResult {
  done: boolean;
  authUrl: string | null;
  state: string | null;
}

export type SyncScope = 'config' | 'configAppdata' | 'custom';

// Day-based, uniformly across every scope - see backend/src/rclone/types.ts's SyncJobRetention.
export interface SyncJobRetention {
  keepDays: number;
  forever: boolean;
}

// What the server actually returns for a job's own encryption state - never the real (obscured)
// password, see backend/src/settings/backupEncryption.ts's redactEncryption() doc comment.
// `hasPassword` is all the UI needs to show a "leave blank to keep the current password"
// placeholder instead of an empty-looks-unset field when editing an already-encrypted job.
export interface SyncJobEncryption {
  enabled: boolean;
  hasPassword: boolean;
}

// The write shape sent on job create/update - `password` is plaintext and write-only (never
// round-tripped back, see SyncJobEncryption above), and only actually required the first time
// `enabled` turns on with nothing saved yet; blank/omitted on an edit means "keep the current
// saved password". Only meaningful for 'config'/'configAppdata' scope - see SyncJob.encryption's
// own doc comment (backend/src/rclone/types.ts) for why 'custom' scope never offers this.
export interface SyncJobEncryptionInput {
  enabled: boolean;
  password?: string;
}

export interface SyncJob {
  id: string;
  name: string;
  enabled: boolean;
  scope: SyncScope;
  customPath: string;
  remoteName: string;
  remotePath: string;
  schedule: RecurringSchedule;
  retention: SyncJobRetention;
  encryption: SyncJobEncryption;
  lastSyncedAt: number | null;
  lastSizeBytes: number | null;
  lastFileCount: number | null;
  lastErrorCount: number | null;
  lastError: string | null;
}

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
  progress: SyncJobProgress | null;
}

export type NewSyncJobInput = Omit<SyncJob, 'id' | 'lastSyncedAt' | 'lastSizeBytes' | 'lastFileCount' | 'lastErrorCount' | 'lastError' | 'encryption'> & {
  encryption: SyncJobEncryptionInput;
};

// GET /rclone/jobs/:id/backups - one archive a 'config'/'configAppdata' scope job has already
// uploaded to its remote target. Only meaningful for those two scopes - a 'custom' scope job
// mirrors a folder live and has nothing resembling this to list (the route 400s instead).
// `encrypted`/`categories` come from the archive's own `.meta.json` sidecar when one exists next
// to it remotely - missing sidecar reads as `encrypted: false, categories: null`, not an error
// (see backend's backupMeta.ts).
export interface RemoteBackupEntry {
  name: string;
  sizeBytes: number;
  modTime: string; // ISO 8601, straight from rclone
  encrypted: boolean;
  categories: BackupCategoryId[] | null;
}
