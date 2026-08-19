import { request } from './request';

export interface LogSource {
  id: string;
  label: string;
}

export interface LogQueryResult {
  logs: string;
  nextSince: number | null;
}

export const logsApi = {
  listSources: () => request<LogSource[]>('/api/logs/sources'),
  getLogs: (sourceId: string, params: { tail?: number; window?: string; since?: number }) => {
    const qs = new URLSearchParams();
    if (params.tail !== undefined) qs.set('tail', String(params.tail));
    if (params.window !== undefined) qs.set('window', params.window);
    if (params.since !== undefined) qs.set('since', String(params.since));
    const suffix = qs.toString();
    return request<LogQueryResult>(`/api/logs/${sourceId}${suffix ? `?${suffix}` : ''}`);
  },
};
