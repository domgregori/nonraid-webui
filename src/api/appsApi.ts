import { API_BASE_URL } from './config';
import { request } from './request';
import type {
  AppSort,
  AppSummary,
  CaApp,
  CreateContainerProgress,
  DockerCommandResult,
  FeedMeta,
  InstallPlan,
  InstallRequest,
} from '../types/appsApi';

/**
 * The install endpoint streams newline-delimited JSON events (progress ticks,
 * then a final done/error event) instead of a single response — pulling a
 * multi-hundred-MB image can take long enough that a silent blocking request
 * reads as hung. `request()` assumes one JSON body, so this reads the stream
 * directly instead of going through it.
 */
async function installStream(name: string, body: InstallRequest, onProgress: (p: CreateContainerProgress) => void): Promise<DockerCommandResult> {
  const res = await fetch(`${API_BASE_URL}/api/apps/${encodeURIComponent(name)}/install`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.body) throw new Error(`Install failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;

      const event = JSON.parse(line) as
        | { type: 'progress'; phase: CreateContainerProgress['phase']; message: string; percent: number | null }
        | { type: 'done'; result: DockerCommandResult }
        | { type: 'error'; message: string };

      if (event.type === 'progress') onProgress({ phase: event.phase, message: event.message, percent: event.percent });
      else if (event.type === 'done') return event.result;
      else throw new Error(event.message);
    }
  }

  throw new Error('Install stream ended without a result');
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
  install: installStream,
};
