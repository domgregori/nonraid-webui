import type { RcloneProvider, RcloneRemote } from './types.js';

export interface RcloneCoreStats {
  bytes: number;
  totalBytes: number;
  speed: number;
  eta: number | null;
  transferring: { name: string; bytes: number; size: number }[] | undefined;
  transfers: number;
  totalTransfers: number;
  errors: number;
  lastError: string | undefined;
}

export interface RcloneJobStatus {
  finished: boolean;
  success: boolean;
  error: string;
  id: number;
}

/** Thin HTTP client for rclone's own `rcd` remote-control daemon - same shape as
 *  tailscale/client.ts's TailscaleClient (an interface + a Real* implementation talking to an
 *  external always-on daemon over its own protocol, not a child process this backend owns). */
export interface RcloneClient {
  /** Whether the `rclone` binary itself is on PATH - independent of whether rcd is reachable. */
  isInstalled(): Promise<boolean>;
  /** Whether rcd answered a live call just now. */
  ping(): Promise<boolean>;
  listProviders(): Promise<RcloneProvider[]>;
  listRemotes(): Promise<{ name: string; type: string }[]>;
  /** A single remote's own saved config, straight from `config/dump` (`type` split out from the
   *  rest) - used to pre-fill the Edit form. Password-type fields come back as rclone's own
   *  *obscured* value (never the plaintext), same as everything else `config/dump` returns - the
   *  frontend deliberately never shows that value in a field, see RemoteBackupSection.tsx's
   *  startEditRemote(). */
  getRemoteConfig(name: string): Promise<{ type: string; parameters: Record<string, string> }>;
  /** Live per-remote connectivity probe (rclone's `operations/about`) - distinguishes a working
   *  remote from one whose auth has expired vs. one that's simply unreachable. */
  checkRemote(name: string): Promise<{ status: RcloneRemote['status']; message: string | null }>;
  /**
   * Most providers (B2, S3-compatible, SFTP, WebDAV, ...) finish in one call - `done: true`,
   * `authUrl`/`state` null. OAuth-based providers (Google Drive, Dropbox, OneDrive, ...) come back
   * with `done: false` and an `authUrl` to open in a browser first (rclone's RC config flow with
   * `opt.nonInteractive: true`) - the caller then polls/calls continueRemoteSetup() with the
   * returned `state` once the user's finished that browser step, same two-step shape as
   * TailscaleClient.login()'s authUrl-then-poll-status flow.
   */
  createRemote(name: string, type: string, parameters: Record<string, string>): Promise<{ done: boolean; authUrl: string | null; state: string | null }>;
  continueRemoteSetup(name: string, type: string, state: string): Promise<{ done: boolean; authUrl: string | null; state: string | null }>;
  updateRemote(name: string, parameters: Record<string, string>): Promise<void>;
  deleteRemote(name: string): Promise<void>;
  /**
   * Starts an async sync/copy operation, returning immediately with rclone's own jobid (`_async:
   * true`). `mode: 'sync'` mirrors dstFs to match srcFs (can delete at the destination); `'copy'`
   * only ever adds/updates. `backupDir`, when set, is rclone's own `--backup-dir` equivalent -
   * changed/deleted files at the destination are moved there instead of deleted outright, which is
   * what SyncJobRetention's day-based "keep changed/deleted versions" scope relies on.
   */
  startSync(opts: { srcFs: string; dstFs: string; mode: 'copy' | 'sync'; backupDir?: string }): Promise<{ jobId: number }>;
  jobStatus(jobId: number): Promise<RcloneJobStatus>;
  /** `group`, when set, scopes stats to one job (rclone's own "job/<id>" stats group) - omit for
   *  the global aggregate across every currently-running transfer. */
  coreStats(group?: string): Promise<RcloneCoreStats>;
  stopJob(jobId: number): Promise<void>;
}
