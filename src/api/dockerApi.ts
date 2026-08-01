import { streamNdjson } from './progressStream';
import { request } from './request';
import type {
  ContainerDetail,
  CreateContainerProgress,
  DockerCommandResult,
  DockerContainerSummary,
  ManualContainerPlan,
  ManualContainerRequest,
} from '../types/dockerApi';

export const dockerApi = {
  listContainers: () => request<DockerContainerSummary[]>('/api/docker/containers'),
  inspectContainer: (id: string) => request<ContainerDetail>(`/api/docker/containers/${id}`),
  startContainer: (id: string) => request<DockerCommandResult>(`/api/docker/containers/${id}/start`, { method: 'POST' }),
  stopContainer: (id: string) => request<DockerCommandResult>(`/api/docker/containers/${id}/stop`, { method: 'POST' }),
  restartContainer: (id: string) => request<DockerCommandResult>(`/api/docker/containers/${id}/restart`, { method: 'POST' }),
  planContainer: (body: ManualContainerRequest) =>
    request<ManualContainerPlan>('/api/docker/containers/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  createContainer: (body: ManualContainerRequest, onProgress: (p: CreateContainerProgress) => void) =>
    streamNdjson(
      '/api/docker/containers',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      onProgress,
    ),
  recreateContainer: (id: string, body: ManualContainerRequest, onProgress: (p: CreateContainerProgress) => void) =>
    streamNdjson(
      `/api/docker/containers/${id}`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      onProgress,
    ),
  getContainerLogs: (id: string, tail?: number) =>
    request<{ logs: string }>(`/api/docker/containers/${id}/logs${tail ? `?tail=${tail}` : ''}`),
};
