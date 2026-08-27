import { request } from './request';
import type { SshStatus } from '../types/sshApi';

export const sshApi = {
  getStatus: () => request<SshStatus>('/api/ssh/status'),
  setEnabled: (enabled: boolean) =>
    request<{ ok: boolean; message: string }>('/api/ssh/enabled', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }),
  // currentPassword (and totpCode, if the account has TOTP enrolled) required - adding a trusted
  // key grants full root shell access, so this is step-up gated server-side (see routes/ssh.ts).
  addKey: (key: string, currentPassword: string, totpCode?: string) =>
    request<{ ok: boolean; keys: SshStatus['keys'] }>('/api/ssh/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, currentPassword, totpCode }),
    }),
  // Step-up gated the same way addKey is - removing a trusted key is just as much an
  // access-control change as adding one (see routes/ssh.ts).
  removeKey: (fingerprint: string, currentPassword: string, totpCode?: string) =>
    request<{ ok: boolean; keys: SshStatus['keys'] }>(`/api/ssh/keys/${encodeURIComponent(fingerprint)}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword, totpCode }),
    }),
};
