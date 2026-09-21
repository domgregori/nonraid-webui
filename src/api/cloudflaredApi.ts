import { request } from './request';
import type { CloudflaredStatus } from '../types/cloudflaredApi';

export const cloudflaredApi = {
  getStatus: () => request<CloudflaredStatus>('/api/cloudflared/status'),
  setEnabled: (enabled: boolean) =>
    request<{ ok: boolean; message: string }>('/api/cloudflared/enabled', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }),
  // Step-up gated - the tunnel token is a real bearer credential (see routes/cloudflared.ts).
  setToken: (token: string, currentPassword: string, totpCode?: string) =>
    request<{ ok: boolean; message: string }>('/api/cloudflared/token', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, currentPassword, totpCode }),
    }),
  setPublicUrl: (publicUrl: string) =>
    request<{ ok: boolean; message: string }>('/api/cloudflared/public-url', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicUrl }),
    }),
};
