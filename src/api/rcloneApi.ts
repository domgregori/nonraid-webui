import { request } from './request';
import type { CommandResult } from '../types/settingsApi';
import type {
  NewSyncJobInput,
  RcloneProvider,
  RcloneRemote,
  RcloneRemoteConfig,
  RcloneRemoteSetupResult,
  RcloneStatus,
  RemoteBackupEntry,
  SyncJob,
  SyncJobWithRuntime,
} from '../types/rcloneApi';
import type { RestorePreview } from '../types/systemApi';

export const rcloneApi = {
  getStatus: () => request<RcloneStatus>('/api/rclone/status'),
  setEnabled: (enabled: boolean) =>
    request<CommandResult>('/api/rclone/enabled', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }),
  getProviders: () => request<RcloneProvider[]>('/api/rclone/providers'),
  getRemotes: () => request<RcloneRemote[]>('/api/rclone/remotes'),
  createRemote: (name: string, type: string, parameters: Record<string, string>) =>
    request<RcloneRemoteSetupResult>('/api/rclone/remotes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, type, parameters }),
    }),
  continueRemoteSetup: (name: string, type: string, state: string) =>
    request<RcloneRemoteSetupResult>(`/api/rclone/remotes/${encodeURIComponent(name)}/continue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, state }),
    }),
  getRemoteConfig: (name: string) => request<RcloneRemoteConfig>(`/api/rclone/remotes/${encodeURIComponent(name)}`),
  updateRemote: (name: string, parameters: Record<string, string>) =>
    request<CommandResult>(`/api/rclone/remotes/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parameters }),
    }),
  deleteRemote: (name: string) => request<CommandResult>(`/api/rclone/remotes/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  getJobs: () => request<SyncJobWithRuntime[]>('/api/rclone/jobs'),
  createJob: (job: NewSyncJobInput) =>
    request<SyncJob>('/api/rclone/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(job),
    }),
  updateJob: (id: string, patch: Partial<NewSyncJobInput>) =>
    request<SyncJob>(`/api/rclone/jobs/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  setJobEnabled: (id: string, enabled: boolean) =>
    request<SyncJob>(`/api/rclone/jobs/${encodeURIComponent(id)}/enabled`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }),
  deleteJob: (id: string) => request<CommandResult>(`/api/rclone/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  syncNow: (id: string) => request<CommandResult>(`/api/rclone/jobs/${encodeURIComponent(id)}/sync`, { method: 'POST' }),
  cancelSync: (id: string) => request<CommandResult>(`/api/rclone/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),

  listJobBackups: (id: string) => request<RemoteBackupEntry[]>(`/api/rclone/jobs/${encodeURIComponent(id)}/backups`),
  previewJobBackupRestore: (id: string, name: string, password?: string) =>
    request<RestorePreview>(`/api/rclone/jobs/${encodeURIComponent(id)}/backups/${encodeURIComponent(name)}/restore-preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    }),

  // Same listing/preview as listJobBackups/previewJobBackupRestore above, but at an arbitrary
  // remote+path with no sync job behind it - onboarding's disaster-recovery restore, which runs
  // before any job has ever been configured (see backend/src/routes/rclone.ts's browse-backups
  // routes).
  browseBackups: (remoteName: string, remotePath: string) =>
    request<RemoteBackupEntry[]>('/api/rclone/browse-backups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ remoteName, remotePath }),
    }),
  browseBackupsRestorePreview: (remoteName: string, remotePath: string, name: string, password?: string) =>
    request<RestorePreview>('/api/rclone/browse-backups/restore-preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ remoteName, remotePath, name, password }),
    }),
};
