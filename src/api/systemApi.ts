import { API_BASE_URL } from './config';
import { request } from './request';
import type { BenchmarkResult } from '../types/benchmark';
import type { ImportResult } from '../types/nmdApi';
import type { CommandResult } from '../types/settingsApi';
import type { BackupCategoryId, BootSnapshot, BootSnapshotList, LocalBackupList, NetLiveRate, RestartServicesResult, RestoreCommitResult, RestorePreview, SystemStats } from '../types/systemApi';

export const systemApi = {
  getStats: () => request<SystemStats>('/api/system'),
  getNetLive: () => request<NetLiveRate>('/api/system/net-live'),
  runBackupNow: () => request<{ bytes: number }>('/api/system/backup/run-now', { method: 'POST' }),
  // `password` is only ever needed for an encrypted archive - the raw-upload flow has no
  // `.meta.json` sidecar of its own to check ahead of time (see backend's own comment on this
  // route), so the first call is always made without one; a PASSWORD_REQUIRED-coded error (see
  // api/request.ts's CodedError) is what tells the caller to ask and retry with one.
  previewConfigRestore: (file: File, password?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (password) form.append('password', password);
    return request<RestorePreview>('/api/system/backup/restore/preview', { method: 'POST', body: form });
  },
  commitConfigRestore: (token: string, categories: BackupCategoryId[]) =>
    request<RestoreCommitResult>('/api/system/backup/restore/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, categories }),
    }),
  listLocalBackups: () => request<LocalBackupList>('/api/system/backup/local/list'),
  previewLocalBackupRestore: (name: string, password?: string) =>
    request<RestorePreview>('/api/system/backup/local/restore/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, password }),
    }),
  // Manual retry for the reload a restore already attempts automatically - see
  // backend/src/routes/system.ts's own comment on why this needs its own endpoint.
  reloadDriver: () => request<{ result: ImportResult }>('/api/system/reload-driver', { method: 'POST' }),
  // The config-restore result screen's single "make everything take effect" action - see
  // backend/src/routes/system.ts's own comment. Resolves once SMB/NFS/driver-reload have run;
  // nonraid-webui's own restart happens after that and drops the connection, so the caller polls
  // getStats() separately to know when it's actually back.
  restartServices: (restartDocker: boolean) =>
    request<RestartServicesResult>('/api/system/restart-services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ restartDocker }),
    }),

  bootDiskImageBackupUrl: () => `${API_BASE_URL}/api/system/boot-disk/backup/image`,
  bootDiskConfigBackupUrl: () => `${API_BASE_URL}/api/system/boot-disk/backup/config`,
  bootDiskConfigBackupEncryptedUrl: () => `${API_BASE_URL}/api/system/boot-disk/backup/config-encrypted`,

  getTimezones: () => request<string[]>('/api/system/timezones'),
  setHostname: (hostname: string) =>
    request<CommandResult>('/api/system/hostname', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hostname }),
    }),
  setTimezone: (timezone: string) =>
    request<CommandResult>('/api/system/timezone', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timezone }),
    }),
  reboot: () => request<CommandResult>('/api/system/reboot', { method: 'POST' }),

  benchmarkBootRead: (durationSeconds: number) =>
    request<BenchmarkResult>('/api/system/boot-disk/benchmark/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ durationSeconds }),
    }),
  benchmarkBootWrite: (durationSeconds: number) =>
    request<BenchmarkResult>('/api/system/boot-disk/benchmark/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ durationSeconds }),
    }),

  listBootSnapshots: () => request<BootSnapshotList>('/api/system/boot-snapshots'),
  createBootSnapshot: (label?: string) =>
    request<BootSnapshot>('/api/system/boot-snapshots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label }),
    }),
  deleteBootSnapshot: (name: string) => request<CommandResult>(`/api/system/boot-snapshots/${encodeURIComponent(name)}`, { method: 'DELETE' }),
};
