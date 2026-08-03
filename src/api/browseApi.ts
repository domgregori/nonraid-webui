import { API_BASE_URL } from './config';
import { request } from './request';
import type { BrowseCommandResult, BrowseListing } from '../types/browseApi';

function withPath(base: string, path: string): string {
  const qs = path ? `?path=${encodeURIComponent(path)}` : '';
  return `${base}${qs}`;
}

const jsonInit = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const browseApi = {
  list: (path: string) => request<BrowseListing>(withPath('/api/browse', path)),

  downloadUrl: (path: string) => `${API_BASE_URL}${withPath('/api/browse/download', path)}`,

  mkdir: (path: string, name: string) => request<BrowseCommandResult>('/api/browse/mkdir', jsonInit({ path, name })),

  rename: (path: string, newName: string) => request<BrowseCommandResult>('/api/browse/rename', jsonInit({ path, newName })),

  move: (path: string, destPath: string) => request<BrowseCommandResult>('/api/browse/move', jsonInit({ path, destPath })),

  remove: (path: string) => request<BrowseCommandResult>(withPath('/api/browse', path), { method: 'DELETE' }),

  upload: async (path: string, files: FileList | File[]): Promise<{ ok: boolean; results: BrowseCommandResult[] }> => {
    const form = new FormData();
    form.append('path', path);
    for (const file of Array.from(files)) form.append('files', file);
    return request('/api/browse/upload', { method: 'POST', body: form });
  },
};
