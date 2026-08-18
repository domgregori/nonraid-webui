import { request } from './request';
import type { TailscaleLoginResult, TailscaleSetOptions, TailscaleStatus } from '../types/tailscaleApi';

export const tailscaleApi = {
  getStatus: () => request<TailscaleStatus>('/api/tailscale/status'),
  setEnabled: (enabled: boolean) =>
    request<{ ok: boolean; message: string }>('/api/tailscale/enabled', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }),
  login: (loginServer?: string) =>
    request<TailscaleLoginResult>('/api/tailscale/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ loginServer: loginServer ?? '' }),
    }),
  logout: () => request<{ ok: boolean; message: string }>('/api/tailscale/logout', { method: 'POST' }),
  setOptions: (options: TailscaleSetOptions) =>
    request<{ ok: boolean; message: string }>('/api/tailscale/options', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(options),
    }),
};
