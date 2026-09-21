export type ShareMode = 'read-only' | 'upload-only' | 'editable';

export interface ShareInfo {
  label: string | null;
  mode: ShareMode;
  requiresPassword: boolean;
}

export interface ShareEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  modifiedAt: string;
  editable?: boolean;
}

export interface BrowseResult {
  path: string;
  entries: ShareEntry[];
}

export interface UploadResult {
  succeeded: { name: string; size: number }[];
  failed: { name: string; error: string }[];
}

// The token is the URL's own first path segment (e.g. https://tunnel-host/<token>) - this app has
// no router, it's a single view with the browsed folder kept as a query param (?path=) on that
// same URL, per the plan's "skips react-router" note.
export function currentToken(): string {
  return decodeURIComponent(window.location.pathname.replace(/^\/+/, '').split('/')[0] ?? '');
}

async function asJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`);
  return body as T;
}

export const shareApi = {
  getInfo(token: string): Promise<ShareInfo> {
    return fetch(`/api/shares/${token}`, { credentials: 'include' }).then((res) => asJson<ShareInfo>(res));
  },

  unlock(token: string, password: string): Promise<{ ok: true; mode: ShareMode; label: string | null }> {
    return fetch(`/api/shares/${token}/unlock`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }).then((res) => asJson(res));
  },

  browse(token: string, path: string): Promise<BrowseResult> {
    return fetch(`/api/shares/${token}/browse?path=${encodeURIComponent(path)}`, { credentials: 'include' }).then((res) => asJson<BrowseResult>(res));
  },

  downloadUrl(token: string, path: string): string {
    return `/api/shares/${token}/download?path=${encodeURIComponent(path)}`;
  },

  readFile(token: string, path: string): Promise<{ content: string }> {
    return fetch(`/api/shares/${token}/read?path=${encodeURIComponent(path)}`, { credentials: 'include' }).then((res) => asJson(res));
  },

  writeFile(token: string, path: string, content: string): Promise<{ ok: true; message: string }> {
    return fetch(`/api/shares/${token}/write`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content }),
    }).then((res) => asJson(res));
  },

  uploadUrl(token: string, path: string): string {
    return `/api/shares/${token}/upload?path=${encodeURIComponent(path)}`;
  },
};
