// Mirrors backend/src/rclone/types.ts plus routes/rclone.ts's response shapes. Keep in sync.
import type { RecurringSchedule } from './settingsApi';

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

export type NewSyncJobInput = Omit<SyncJob, 'id' | 'lastSyncedAt' | 'lastSizeBytes' | 'lastFileCount' | 'lastErrorCount' | 'lastError'>;
