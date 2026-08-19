import { request } from './request';
import type { Share, ShareCommandResult, ShareInput, ShareWithStats } from '../types/sharesApi';

const jsonInit = (method: string, body: ShareInput): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const sharesApi = {
  list: () => request<ShareWithStats[]>('/api/shares'),
  create: (input: ShareInput) => request<Share>('/api/shares', jsonInit('POST', input)),
  update: (name: string, input: ShareInput) => request<Share>(`/api/shares/${encodeURIComponent(name)}`, jsonInit('PUT', input)),
  remove: (name: string) => request<ShareCommandResult>(`/api/shares/${encodeURIComponent(name)}`, { method: 'DELETE' }),
};
