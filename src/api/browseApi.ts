import { API_BASE_URL } from './config';
import { streamNdjson } from './progressStream';
import { request } from './request';
import type { BrowseCommandResult, BrowseFileContent, BrowseListing, BulkOp, BulkOpProgress, BulkOpResult, PathSuggestions } from '../types/browseApi';

export type PathSuggestScope = 'browse' | 'binds';

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

  // A folder, or several selected entries within one folder - `dir` is their shared parent (the
  // Browse page's selection is always siblings), `names` their basenames. Kept short even for a
  // large selection since only the names travel in the URL, not each one's full path.
  downloadArchiveUrl: (dir: string, names: string[]) =>
    `${API_BASE_URL}/api/browse/download-archive?path=${encodeURIComponent(dir)}&names=${encodeURIComponent(JSON.stringify(names))}`,

  readFile: (path: string) => request<BrowseFileContent>(withPath('/api/browse/read', path)),

  writeFile: (path: string, content: string) => request<BrowseCommandResult>('/api/browse/write', jsonInit({ path, content })),

  mkdir: (path: string, name: string) => request<BrowseCommandResult>('/api/browse/mkdir', jsonInit({ path, name })),

  rename: (path: string, newName: string) => request<BrowseCommandResult>('/api/browse/rename', jsonInit({ path, newName })),

  calculateSize: (path: string) => request<{ bytes: number }>(withPath('/api/browse/size', path)),

  // Copy/Move/Delete over one or more paths - used for both single-row actions and multi-select,
  // always through the streamed/cancelable path (see progressStream.ts).
  bulk: (paths: string[], op: BulkOp, destPath: string | undefined, onProgress: (p: BulkOpProgress) => void, signal: AbortSignal) =>
    streamNdjson<BulkOpProgress, BulkOpResult>(
      '/api/browse/bulk',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths, op, destPath }), signal },
      onProgress,
    ),

  suggest: (path: string, scope: PathSuggestScope) =>
    request<PathSuggestions>(`/api/browse/suggest?path=${encodeURIComponent(path)}&scope=${scope}`),

  upload: async (path: string, files: FileList | File[]): Promise<{ ok: boolean; results: BrowseCommandResult[] }> => {
    const form = new FormData();
    form.append('path', path);
    for (const file of Array.from(files)) form.append('files', file);
    return request('/api/browse/upload', { method: 'POST', body: form });
  },
};
