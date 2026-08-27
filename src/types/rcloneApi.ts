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
  // The advanced/power-user fields, rolled up behind AddRemoteForm's own "More options"
  // disclosure - see backend/src/rclone/types.ts's RcloneProvider doc comment.
  advancedOptions: RcloneProviderOption[];
  // True for a provider that drives rclone's own OAuth web flow (config/create returns `done:
  // false` + an authUrl) - lets AddRemoteForm offer a one-click "Connect with X" shortcut.
  oauth: boolean;
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

/** Result of POST /rclone/remotes or POST /rclone/remotes/:name/continue. Most providers finish in
 *  one call (`done: true`). An OAuth provider (Drive, Dropbox, ...) comes back with `needsToken:
 *  true` - the backend has already answered rclone's own housekeeping prompts (see
 *  backend/src/rclone/types.ts's doc comment on this same type for the full reasoning); the admin
 *  runs `rclone authorize "<type>"` on a machine with a browser and pastes the result back via
 *  continueRemoteSetup(). `authUrl` is kept for completeness but no provider tested so far
 *  actually reaches it - a directly-openable URL would need a browser on this same headless box. */
export interface RcloneRemoteSetupResult {
  done: boolean;
  authUrl: string | null;
  state: string | null;
  needsToken: boolean;
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
