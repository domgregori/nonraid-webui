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
  // Retrievable for the life of the share, not just shown once at creation - see
  // backend/src/shareLinks/service.ts's own doc comment for why a reversible encryption-at-rest,
  // not a one-way hash, is the right call for this particular credential.
  token: string;
}

// Alias kept so existing imports don't need to change - creation and every other read return the
// identical shape now, there's no more "only returned once" special case.
export type CreatedShareLink = ShareLink;

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

export interface UpdateShareLinkInput {
  label?: string | null;
  expiresAt?: number | null;
  revoked?: boolean;
  mode?: ShareMode;
  allowDelete?: boolean;
  // undefined = leave as-is; null = clear the password; a string = set a new one.
  password?: string | null;
  uploadQuotaBytes?: number | null;
  maxFileSizeBytes?: number | null;
}

export interface ShareLinkAccessLogEntry {
  id: number;
  shareId: string;
  ts: number;
  kind: 'list' | 'download' | 'upload' | 'edit' | 'unlock';
  ip: string | null;
  detail: string | null;
}
