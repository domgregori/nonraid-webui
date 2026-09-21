export type ShareMode = 'read-only' | 'upload-only' | 'editable';

export interface ShareLink {
  id: string;
  rootPath: string;
  label: string | null;
  mode: ShareMode;
  allowDelete: boolean;
  uploadQuotaBytes: number | null;
  maxFileSizeBytes: number | null;
  uploadUsedBytes: number;
  downloadCount: number;
  expiresAt: number | null;
  revokedAt: number | null;
  lastAccessedAt: number | null;
  createdAt: number;
  createdBy: string;
  hasPassword: boolean;
}

// Returned exactly once, right after creation - includes the raw bearer token, never retrievable
// again afterward (see backend/src/shareLinks/service.ts's own doc comment).
export type CreatedShareLink = ShareLink & { token: string };

export interface CreateShareLinkInput {
  rootPath: string;
  mode: ShareMode;
  label?: string;
  allowDelete?: boolean;
  password?: string;
  uploadQuotaBytes?: number | null;
  maxFileSizeBytes?: number | null;
  expiresAt?: number | null;
}

export interface ShareLinkAccessLogEntry {
  id: number;
  shareId: string;
  ts: number;
  kind: 'list' | 'download' | 'upload' | 'edit' | 'unlock';
  ip: string | null;
  detail: string | null;
}
