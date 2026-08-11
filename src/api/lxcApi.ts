import { streamNdjson } from './progressStream';
import { request } from './request';
import type {
  CreateLxcContainerRequest,
  CreateLxcProgress,
  LxcCommandResult,
  LxcContainerDetail,
  LxcContainerSummary,
  LxcDistrosResponse,
  LxcSnapshot,
  PruneTemplateCacheResult,
} from '../types/lxcApi';
import type { LxcStorageInfo, StorageLocation, StoragePathProgress, StoragePathResult } from '../types/storagePath';

export const lxcApi = {
  listContainers: () => request<LxcContainerSummary[]>('/api/lxc/containers'),
  inspectContainer: (name: string) => request<LxcContainerDetail>(`/api/lxc/containers/${encodeURIComponent(name)}`),
  listDistros: () => request<LxcDistrosResponse>('/api/lxc/distros'),
  listBridges: () => request<string[]>('/api/lxc/bridges'),
  listInterfaces: () => request<string[]>('/api/lxc/interfaces'),
  startContainer: (name: string) =>
    request<LxcCommandResult>(`/api/lxc/containers/${encodeURIComponent(name)}/start`, { method: 'POST' }),
  stopContainer: (name: string, force = false) =>
    request<LxcCommandResult>(`/api/lxc/containers/${encodeURIComponent(name)}/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ force }),
    }),
  restartContainer: (name: string) =>
    request<LxcCommandResult>(`/api/lxc/containers/${encodeURIComponent(name)}/restart`, { method: 'POST' }),
  destroyContainer: (name: string) =>
    request<LxcCommandResult>(`/api/lxc/containers/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  getConfigText: (name: string) =>
    request<{ content: string }>(`/api/lxc/containers/${encodeURIComponent(name)}/config`),
  setConfigText: (name: string, content: string) =>
    request<LxcCommandResult>(`/api/lxc/containers/${encodeURIComponent(name)}/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    }),
  createContainer: (body: CreateLxcContainerRequest, onProgress: (p: CreateLxcProgress) => void) =>
    streamNdjson<CreateLxcProgress, LxcCommandResult>(
      '/api/lxc/containers',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      onProgress,
    ),
  listSnapshots: (name: string) => request<LxcSnapshot[]>(`/api/lxc/containers/${encodeURIComponent(name)}/snapshots`),
  createSnapshot: (name: string, comment: string) =>
    request<LxcCommandResult>(`/api/lxc/containers/${encodeURIComponent(name)}/snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comment }),
    }),
  restoreSnapshot: (name: string, snapshotName: string, newName: string) =>
    request<LxcCommandResult>(`/api/lxc/containers/${encodeURIComponent(name)}/snapshots/${encodeURIComponent(snapshotName)}/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newName }),
    }),
  deleteSnapshot: (name: string, snapshotName: string) =>
    request<LxcCommandResult>(`/api/lxc/containers/${encodeURIComponent(name)}/snapshots/${encodeURIComponent(snapshotName)}`, {
      method: 'DELETE',
    }),
  pruneTemplateCache: () => request<PruneTemplateCacheResult>('/api/lxc/template-cache/prune', { method: 'POST' }),
  getStorage: () => request<LxcStorageInfo>('/api/lxc/storage'),
  moveStorage: (target: StorageLocation, onProgress: (p: StoragePathProgress) => void) =>
    streamNdjson<StoragePathProgress, StoragePathResult>(
      '/api/lxc/storage',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(target) },
      onProgress,
    ),
};
