import { request } from './request';
import type { TlsApplyResult, TlsStatus } from '../types/tlsApi';

export const tlsApi = {
  getStatus: () => request<TlsStatus>('/api/tls/status'),
  generateSelfSigned: (input: { commonName: string; sans: string[]; days?: number }) =>
    request<TlsStatus>('/api/tls/self-signed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  enable: () => request<TlsApplyResult>('/api/tls/enable', { method: 'POST' }),
  disable: () => request<TlsApplyResult>('/api/tls/disable', { method: 'POST' }),
};
