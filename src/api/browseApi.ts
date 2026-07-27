import { API_BASE_URL } from './config';
import { request } from './request';
import type { BrowseCommandResult, BrowseListing } from '../types/browseApi';

function withPath(base: string, relPath: string): string {
  const qs = relPath ? `?path=${encodeURIComponent(relPath)}` : '';
  return `${base}${qs}`;
}

const jsonInit = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const browseApi = {
  list: (share: string, path: string) => request<BrowseListing>(withPath(`/api/browse/${encodeURIComponent(share)}`, path)),

  downloadUrl: (share: string, path: string) => `${API_BASE_URL}${withPath(`/api/browse/${encodeURIComponent(share)}/download`, path)}`,

  mkdir: (share: string, path: string, name: string) =>
    request<BrowseCommandResult>(`/api/browse/${encodeURIComponent(share)}/mkdir`, jsonInit({ path, name })),

  rename: (share: string, path: string, newName: string) =>
    request<BrowseCommandResult>(`/api/browse/${encodeURIComponent(share)}/rename`, jsonInit({ path, newName })),

  move: (share: string, path: string, destPath: string) =>
    request<BrowseCommandResult>(`/api/browse/${encodeURIComponent(share)}/move`, jsonInit({ path, destPath })),

  remove: (share: string, path: string) =>
    request<BrowseCommandResult>(withPath(`/api/browse/${encodeURIComponent(share)}`, path), { method: 'DELETE' }),

  upload: async (share: string, path: string, files: FileList | File[]): Promise<{ ok: boolean; results: BrowseCommandResult[] }> => {
    const form = new FormData();
    form.append('path', path);
    for (const file of Array.from(files)) form.append('files', file);
    return request(`/api/browse/${encodeURIComponent(share)}/upload`, { method: 'POST', body: form });
  },
};
