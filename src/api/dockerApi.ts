import { request } from './request';
import type { DockerCommandResult, DockerContainerSummary } from '../types/dockerApi';

export const dockerApi = {
  listContainers: () => request<DockerContainerSummary[]>('/api/docker/containers'),
  startContainer: (id: string) => request<DockerCommandResult>(`/api/docker/containers/${id}/start`, { method: 'POST' }),
  stopContainer: (id: string) => request<DockerCommandResult>(`/api/docker/containers/${id}/stop`, { method: 'POST' }),
  restartContainer: (id: string) => request<DockerCommandResult>(`/api/docker/containers/${id}/restart`, { method: 'POST' }),
};
