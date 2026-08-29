import { request } from './request';
import type { ApiTokenEntry, ApiTokenScope, CreatedApiToken } from '../types/apiTokenApi';

export const apiTokenApi = {
  list: () => request<ApiTokenEntry[]>('/api/auth/tokens'),
  // currentPassword (and totpCode, if the account has TOTP enrolled) required - minting a token
  // grants durable, non-interactive API access, so this is step-up gated server-side the same way
  // adding a trusted SSH key is (see routes/auth.ts). scope defaults to 'full' server-side if
  // omitted, but this UI always sends one explicitly.
  create: (name: string, scope: ApiTokenScope, currentPassword: string, totpCode?: string) =>
    request<CreatedApiToken>('/api/auth/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, scope, currentPassword, totpCode }),
    }),
  // Session-gated only, not step-up - revoking only removes access (see routes/auth.ts).
  revoke: (id: string) =>
    request<{ ok: boolean }>(`/api/auth/tokens/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};
