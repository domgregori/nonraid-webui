import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export type ShareMode = 'read-only' | 'upload-only' | 'editable';

export interface ShareLinkRecord {
  id: string;
  tokenHash: string;
  tokenEncrypted: string;
  passwordHash: string | null;
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
}

export interface CreateShareLinkInput {
  id: string;
  tokenHash: string;
  tokenEncrypted: string;
  passwordHash: string | null;
  rootPath: string;
  label: string | null;
  mode: ShareMode;
  allowDelete: boolean;
  uploadQuotaBytes: number | null;
  maxFileSizeBytes: number | null;
  expiresAt: number | null;
  createdBy: string;
}

export interface UpdateShareLinkInput {
  label?: string | null;
  expiresAt?: number | null;
  revoked?: boolean;
  mode?: ShareMode;
  allowDelete?: boolean;
  // undefined = leave the password as-is; null = clear it (share becomes passwordless);
  // a string = the new plaintext password to hash and set (service.ts does the hashing before
  // this reaches the store - this field is passwordHash, already hashed, by the time it gets here).
  passwordHash?: string | null;
  uploadQuotaBytes?: number | null;
  maxFileSizeBytes?: number | null;
}

export interface ShareLinkAccessLogEntry {
  id: number;
  shareId: string;
  ts: number;
  kind: string;
  ip: string | null;
  detail: string | null;
}

interface ShareLinkRow {
  id: string;
  token_hash: string;
  token_encrypted: string;
  password_hash: string | null;
  root_path: string;
  label: string | null;
  mode: string;
  allow_delete: number;
  upload_quota_bytes: number | null;
  max_file_size_bytes: number | null;
  upload_used_bytes: number;
  download_count: number;
  expires_at: number | null;
  revoked_at: number | null;
  last_accessed_at: number | null;
  created_at: number;
  created_by: string;
}

function rowToRecord(row: ShareLinkRow): ShareLinkRecord {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    tokenEncrypted: row.token_encrypted,
    passwordHash: row.password_hash,
    rootPath: row.root_path,
    label: row.label,
    mode: row.mode as ShareMode,
    allowDelete: row.allow_delete === 1,
    uploadQuotaBytes: row.upload_quota_bytes,
    maxFileSizeBytes: row.max_file_size_bytes,
    uploadUsedBytes: row.upload_used_bytes,
    downloadCount: row.download_count,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastAccessedAt: row.last_accessed_at,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

/**
 * SQLite WAL mode, same precedent as backend/src/metrics/db.ts - no `busy_timeout` needed here
 * (unlike a naive port of the earlier draft might assume) because this is a direct consequence of
 * the RPC redesign: share-server never opens this file at all, so the admin backend is the *only*
 * process that ever touches it, and single-writer WAL needs no cross-process contention handling.
 *
 * This store, and this file alone, is the sole owner of share_link.db. Every other process
 * (including share-server, the actual public-facing surface) reaches this data only through
 * ShareLinkRpcServer's narrowly-typed RPC methods (see rpcServer.ts) - never a database file
 * handle. That boundary is the core security upgrade this feature is built around; nothing
 * outside this file should ever construct a second `Database` handle onto this same path.
 */
export class ShareLinkStore {
  private db: Database.Database;

  constructor(filePath: string = config.shareLinksDbPath) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS share_link (
        id                 TEXT PRIMARY KEY,
        token_hash         TEXT NOT NULL UNIQUE,
        token_encrypted    TEXT NOT NULL,
        password_hash      TEXT,
        root_path          TEXT NOT NULL,
        label              TEXT,
        mode               TEXT NOT NULL,
        allow_delete       INTEGER NOT NULL DEFAULT 0,
        upload_quota_bytes INTEGER,
        max_file_size_bytes INTEGER,
        upload_used_bytes  INTEGER NOT NULL DEFAULT 0,
        download_count     INTEGER NOT NULL DEFAULT 0,
        expires_at         INTEGER,
        revoked_at         INTEGER,
        last_accessed_at   INTEGER,
        created_at         INTEGER NOT NULL,
        created_by         TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS share_link_access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        share_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        ip TEXT,
        detail TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_access_log_share_ts ON share_link_access_log(share_id, ts);
    `);
  }

  create(input: CreateShareLinkInput): ShareLinkRecord {
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO share_link
          (id, token_hash, token_encrypted, password_hash, root_path, label, mode, allow_delete, upload_quota_bytes, max_file_size_bytes, upload_used_bytes, download_count, expires_at, revoked_at, last_accessed_at, created_at, created_by)
         VALUES (@id, @tokenHash, @tokenEncrypted, @passwordHash, @rootPath, @label, @mode, @allowDelete, @uploadQuotaBytes, @maxFileSizeBytes, 0, 0, @expiresAt, NULL, NULL, @createdAt, @createdBy)`,
      )
      .run({
        id: input.id,
        tokenHash: input.tokenHash,
        tokenEncrypted: input.tokenEncrypted,
        passwordHash: input.passwordHash,
        rootPath: input.rootPath,
        label: input.label,
        mode: input.mode,
        allowDelete: input.allowDelete ? 1 : 0,
        uploadQuotaBytes: input.uploadQuotaBytes,
        maxFileSizeBytes: input.maxFileSizeBytes,
        expiresAt: input.expiresAt,
        createdAt,
        createdBy: input.createdBy,
      });
    // Non-null: the row was just inserted with this exact id inside the same call.
    return this.getById(input.id) as ShareLinkRecord;
  }

  getById(id: string): ShareLinkRecord | null {
    const row = this.db.prepare('SELECT * FROM share_link WHERE id = ?').get(id) as ShareLinkRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  // Looked up on every anonymous unlock attempt via RPC - token_hash has a UNIQUE index, so this
  // is an indexed point lookup, not a scan.
  getByTokenHash(tokenHash: string): ShareLinkRecord | null {
    const row = this.db.prepare('SELECT * FROM share_link WHERE token_hash = ?').get(tokenHash) as ShareLinkRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  list(): ShareLinkRecord[] {
    const rows = this.db.prepare('SELECT * FROM share_link ORDER BY created_at DESC').all() as ShareLinkRow[];
    return rows.map(rowToRecord);
  }

  update(id: string, patch: UpdateShareLinkInput): ShareLinkRecord | null {
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };
    if (patch.label !== undefined) {
      sets.push('label = @label');
      params.label = patch.label;
    }
    if (patch.expiresAt !== undefined) {
      sets.push('expires_at = @expiresAt');
      params.expiresAt = patch.expiresAt;
    }
    if (patch.revoked !== undefined) {
      sets.push('revoked_at = @revokedAt');
      params.revokedAt = patch.revoked ? Date.now() : null;
    }
    if (patch.mode !== undefined) {
      sets.push('mode = @mode');
      params.mode = patch.mode;
    }
    if (patch.allowDelete !== undefined) {
      sets.push('allow_delete = @allowDelete');
      params.allowDelete = patch.allowDelete ? 1 : 0;
    }
    if (patch.passwordHash !== undefined) {
      sets.push('password_hash = @passwordHash');
      params.passwordHash = patch.passwordHash;
    }
    if (patch.uploadQuotaBytes !== undefined) {
      sets.push('upload_quota_bytes = @uploadQuotaBytes');
      params.uploadQuotaBytes = patch.uploadQuotaBytes;
    }
    if (patch.maxFileSizeBytes !== undefined) {
      sets.push('max_file_size_bytes = @maxFileSizeBytes');
      params.maxFileSizeBytes = patch.maxFileSizeBytes;
    }
    if (sets.length === 0) return this.getById(id);
    this.db.prepare(`UPDATE share_link SET ${sets.join(', ')} WHERE id = @id`).run(params);
    return this.getById(id);
  }

  touchLastAccessed(id: string): void {
    this.db.prepare('UPDATE share_link SET last_accessed_at = ? WHERE id = ?').run(Date.now(), id);
  }

  recordDownload(id: string): void {
    this.db.prepare('UPDATE share_link SET download_count = download_count + 1, last_accessed_at = ? WHERE id = ?').run(Date.now(), id);
  }

  /**
   * The atomic quota-reserve dance: succeeds (and books the bytes) in the same statement that
   * checks the quota, so two concurrent uploads racing the same share's remaining headroom can't
   * both observe "there's room" and then both write - whichever UPDATE's WHERE clause loses the
   * race after the other's write already landed simply matches zero rows. Also refuses a reservation
   * against a revoked or expired share, so a reservation can never outlive the share's own validity
   * window even if the caller's own resolveShareForOp check raced a revocation.
   */
  reserveUploadBytes(id: string, declaredBytes: number): boolean {
    const info = this.db
      .prepare(
        `UPDATE share_link
         SET upload_used_bytes = upload_used_bytes + @declaredBytes
         WHERE id = @id
           AND (upload_quota_bytes IS NULL OR upload_used_bytes + @declaredBytes <= upload_quota_bytes)
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > @now)`,
      )
      .run({ id, declaredBytes, now: Date.now() });
    return info.changes > 0;
  }

  /** Reconciles a reservation against what an upload actually wrote - deltaBytes is negative to
   *  give back an over-reservation (aborted mid-stream, or the declared Content-Length
   *  overestimated the real size), positive in the rarer case where more was written than
   *  declared. Clamped at 0 so a buggy/malicious sequence of calls can never drive the running
   *  total negative. */
  trueUpUploadBytes(id: string, deltaBytes: number): void {
    this.db.prepare('UPDATE share_link SET upload_used_bytes = MAX(0, upload_used_bytes + ?) WHERE id = ?').run(deltaBytes, id);
  }

  logAccess(shareId: string, kind: string, ip: string | null, detail: string | null): void {
    this.db.prepare('INSERT INTO share_link_access_log (share_id, ts, kind, ip, detail) VALUES (?, ?, ?, ?, ?)').run(shareId, Date.now(), kind, ip, detail);
  }

  getAccessLog(shareId: string, limit = 200): ShareLinkAccessLogEntry[] {
    const rows = this.db
      .prepare('SELECT id, share_id as shareId, ts, kind, ip, detail FROM share_link_access_log WHERE share_id = ? ORDER BY ts DESC LIMIT ?')
      .all(shareId, limit) as ShareLinkAccessLogEntry[];
    return rows;
  }
}
