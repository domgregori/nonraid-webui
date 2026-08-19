import { request } from './request';
import type { TlsApplyResult, TlsImportPreview, TlsStatus } from '../types/tlsApi';

export const tlsApi = {
  getStatus: () => request<TlsStatus>('/api/tls/status'),
  generateSelfSigned: (input: { commonName: string; sans: string[]; days?: number }) =>
    request<TlsStatus>('/api/tls/self-signed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  previewImport: (cert: File, key: File) => {
    const form = new FormData();
    form.append('cert', cert);
    form.append('key', key);
    return request<TlsImportPreview>('/api/tls/import/preview', { method: 'POST', body: form });
  },
  commitImport: (token: string) =>
    request<TlsStatus>('/api/tls/import/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    }),
  enable: () => request<TlsApplyResult>('/api/tls/enable', { method: 'POST' }),
  disable: () => request<TlsApplyResult>('/api/tls/disable', { method: 'POST' }),
};
