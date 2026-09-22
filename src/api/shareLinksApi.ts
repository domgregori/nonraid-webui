import { request } from './request';
import type { CreateShareLinkInput, CreatedShareLink, ShareLink, ShareLinkAccessLogEntry, UpdateShareLinkInput } from '../types/shareLinksApi';

export const shareLinksApi = {
  list: () => request<ShareLink[]>('/api/share-links'),

  // Session-gated only, same as every other mutating route in this app - see routes/shareLinks.ts.
  create: (input: CreateShareLinkInput) =>
    request<CreatedShareLink>('/api/share-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),

  update: (id: string, patch: UpdateShareLinkInput) =>
    request<ShareLink>(`/api/share-links/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),

  activity: (id: string) => request<ShareLinkAccessLogEntry[]>(`/api/share-links/${encodeURIComponent(id)}/activity`),

  // 409s if the share is still live (not revoked, not expired) - see routes/shareLinks.ts.
  remove: (id: string) => request<{ ok: true }>(`/api/share-links/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
