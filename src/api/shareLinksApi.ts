import { request } from './request';
import type { CreateShareLinkInput, CreatedShareLink, ShareLink, ShareLinkAccessLogEntry } from '../types/shareLinksApi';

export const shareLinksApi = {
  list: () => request<ShareLink[]>('/api/share-links'),

  // currentPassword (and totpCode, if the account has TOTP enrolled) required - creating a share
  // link is real, internet-reachable access to array data once a Cloudflare Tunnel is on, so this
  // is step-up gated server-side (see routes/shareLinks.ts).
  create: (input: CreateShareLinkInput, currentPassword: string, totpCode?: string) =>
    request<CreatedShareLink>('/api/share-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, currentPassword, totpCode }),
    }),

  // Not step-up gated - revoking (or editing the label/expiry of) an already-created link only
  // ever narrows access (see routes/shareLinks.ts's own doc comment).
  update: (id: string, patch: { label?: string | null; expiresAt?: number | null; revoked?: boolean }) =>
    request<ShareLink>(`/api/share-links/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),

  activity: (id: string) => request<ShareLinkAccessLogEntry[]>(`/api/share-links/${encodeURIComponent(id)}/activity`),
};
