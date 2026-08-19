import { streamNdjson } from './progressStream';
import { request } from './request';
import type { AppSort, AppSummary, CaApp, DockerCommandResult, FeedMeta, InstallPlan, InstallRequest } from '../types/appsApi';
import type { CreateContainerProgress } from '../types/dockerApi';

function install(name: string, body: InstallRequest, onProgress: (p: CreateContainerProgress) => void): Promise<DockerCommandResult> {
  return streamNdjson(
    `/api/apps/${encodeURIComponent(name)}/install`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    onProgress,
  );
}

export const appsApi = {
  listApps: (query: { search?: string; category?: string; sort?: AppSort } = {}) => {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.category) params.set('category', query.category);
    if (query.sort) params.set('sort', query.sort);
    const qs = params.toString();
    return request<AppSummary[]>(`/api/apps${qs ? `?${qs}` : ''}`);
  },
  listCategories: () => request<string[]>('/api/apps/categories'),
  getFeedMeta: () => request<FeedMeta>('/api/apps/meta'),
  refreshFeed: () => request<FeedMeta>('/api/apps/refresh', { method: 'POST' }),
  getApp: (name: string, repository?: string) =>
    request<CaApp>(
      `/api/apps/${encodeURIComponent(name)}${repository ? `?repository=${encodeURIComponent(repository)}` : ''}`,
    ),
  planInstall: (name: string, body: InstallRequest) =>
    request<InstallPlan>(`/api/apps/${encodeURIComponent(name)}/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  install,
};
