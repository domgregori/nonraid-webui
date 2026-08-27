import { streamNdjson } from './progressStream';
import { request } from './request';
import type {
  ContainerDetail,
  ContainerUpdateStatus,
  CreateContainerProgress,
  DockerCommandResult,
  DockerContainerSummary,
  HostDevice,
  ManualContainerPlan,
  ManualContainerRequest,
  PruneImagesResult,
} from '../types/dockerApi';
import type { DockerStorageInfo, StorageLocation, StoragePathProgress, StoragePathResult } from '../types/storagePath';

export const dockerApi = {
  listContainers: () => request<DockerContainerSummary[]>('/api/docker/containers'),
  inspectContainer: (id: string) => request<ContainerDetail>(`/api/docker/containers/${id}`),
  startContainer: (id: string) => request<DockerCommandResult>(`/api/docker/containers/${id}/start`, { method: 'POST' }),
  stopContainer: (id: string) => request<DockerCommandResult>(`/api/docker/containers/${id}/stop`, { method: 'POST' }),
  restartContainer: (id: string) => request<DockerCommandResult>(`/api/docker/containers/${id}/restart`, { method: 'POST' }),
  removeContainer: (id: string) => request<DockerCommandResult>(`/api/docker/containers/${id}`, { method: 'DELETE' }),
  setAutostart: (id: string, autostart: boolean) =>
    request<DockerCommandResult>(`/api/docker/containers/${id}/autostart`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ autostart }),
    }),
  planContainer: (body: ManualContainerRequest) =>
    request<ManualContainerPlan>('/api/docker/containers/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  createContainer: (body: ManualContainerRequest, onProgress: (p: CreateContainerProgress) => void) =>
    streamNdjson<CreateContainerProgress, DockerCommandResult>(
      '/api/docker/containers',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      onProgress,
    ),
  recreateContainer: (id: string, body: ManualContainerRequest, onProgress: (p: CreateContainerProgress) => void) =>
    streamNdjson<CreateContainerProgress, DockerCommandResult>(
      `/api/docker/containers/${id}`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      onProgress,
    ),
  getContainerLogs: (id: string, tail?: number, since?: number) => {
    const params = new URLSearchParams();
    if (tail) params.set('tail', String(tail));
    if (since !== undefined) params.set('since', String(since));
    const qs = params.toString();
    return request<{ logs: string; nextSince: number | null }>(`/api/docker/containers/${id}/logs${qs ? `?${qs}` : ''}`);
  },
  pruneImages: () => request<PruneImagesResult>('/api/docker/images/prune', { method: 'POST' }),
  // Cheap, cached - whatever the last check found for every currently-listed container.
  getUpdateStatus: () => request<Record<string, ContainerUpdateStatus>>('/api/docker/update-status'),
  // The only call that actually pulls every container's image - "Check for updates" button.
  checkUpdates: () => request<Record<string, ContainerUpdateStatus>>('/api/docker/update-status/check', { method: 'POST' }),
  updateContainerNow: (id: string) => request<DockerCommandResult>(`/api/docker/containers/${id}/update-now`, { method: 'POST' }),
  listDevices: () => request<HostDevice[]>('/api/docker/devices'),
  listNetworks: () => request<string[]>('/api/docker/networks'),
  getStorage: () => request<DockerStorageInfo>('/api/docker/storage'),
  moveStorage: (target: StorageLocation, onProgress: (p: StoragePathProgress) => void) =>
    streamNdjson<StoragePathProgress, StoragePathResult>(
      '/api/docker/storage',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(target) },
      onProgress,
    ),
};
