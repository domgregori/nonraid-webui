import { createHash, randomUUID } from 'node:crypto';
import { generateShareToken, hashSecret } from '../auth/crypto.js';
import { resolveExisting } from '../browse/paths.js';
import { HttpError } from '../httpError.js';
import { ShareLinkStore, type ShareLinkAccessLogEntry, type ShareLinkRecord, type ShareMode, type UpdateShareLinkInput } from './store.js';

export interface CreateShareLinkOptions {
  rootPath: string;
  label?: string;
  mode: ShareMode;
  allowDelete?: boolean;
  password?: string;
  uploadQuotaBytes?: number | null;
  maxFileSizeBytes?: number | null;
  expiresAt?: number | null;
  createdBy: string;
}

// The admin-facing shape of a share link - never includes tokenHash or passwordHash. `hasPassword`
// tells the UI whether a password was set, without ever exposing the hash (or the password itself,
// which this app never keeps past the one hashSecret() call at creation time).
export type PublicShareLink = Omit<ShareLinkRecord, 'tokenHash' | 'passwordHash'> & { hasPassword: boolean };

// Returned exactly once, right after creation - same "raw secret shown once, hash persisted from
// then on" precedent as AuthService.createApiToken(). token is never retrievable again afterward;
// losing it means creating a new share link.
export type CreatedShareLink = PublicShareLink & { token: string };

function toPublic(record: ShareLinkRecord): PublicShareLink {
  const { tokenHash: _tokenHash, passwordHash, ...rest } = record;
  return { ...rest, hasPassword: passwordHash !== null };
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Owns share_link.db (via ShareLinkStore) and is the only place a share's password is ever
 * checked against a *plaintext* candidate at rest-write time (hashSecret at creation) - the
 * corresponding read-time check (verifySecret) lives in rpcServer.ts's unlockShare handler, the
 * other half of "password verification happens inside the admin backend only".
 */
export class ShareLinkService {
  constructor(private store: ShareLinkStore) {}

  async create(opts: CreateShareLinkOptions): Promise<CreatedShareLink> {
    if (opts.mode !== 'read-only' && opts.mode !== 'upload-only' && opts.mode !== 'editable') {
      throw new HttpError(400, 'mode must be "read-only", "upload-only", or "editable".');
    }
    // Validated the exact same way every other browse operation is - resolveExisting() already
    // enforces the browse-root traversal ceiling and symlink-escape protection, so a share's
    // root_path can never point outside /mnt even if the admin UI were somehow tricked into
    // sending a crafted path.
    const { absPath } = await resolveExisting(opts.rootPath);

    const token = generateShareToken();
    const tokenHash = sha256Hex(token);
    const passwordHash = opts.password ? await hashSecret(opts.password) : null;
    const id = randomUUID();

    const record = this.store.create({
      id,
      tokenHash,
      passwordHash,
      rootPath: absPath,
      label: opts.label?.trim() || null,
      mode: opts.mode,
      // allow_delete is reserved for a v1.1 follow-up (see the plan's explicit v1 scope limits) -
      // stored if the caller sends it, but nothing in share-server's own v1 routes ever acts on it.
      allowDelete: opts.mode === 'editable' ? opts.allowDelete === true : false,
      uploadQuotaBytes: opts.uploadQuotaBytes ?? null,
      maxFileSizeBytes: opts.maxFileSizeBytes ?? null,
      expiresAt: opts.expiresAt ?? null,
      createdBy: opts.createdBy,
    });

    return { ...toPublic(record), token };
  }

  list(): PublicShareLink[] {
    return this.store.list().map(toPublic);
  }

  update(id: string, patch: UpdateShareLinkInput): PublicShareLink {
    if (!this.store.getById(id)) throw new HttpError(404, 'Share link not found.');
    const updated = this.store.update(id, patch);
    if (!updated) throw new HttpError(404, 'Share link not found.');
    return toPublic(updated);
  }

  getActivity(id: string, limit?: number): ShareLinkAccessLogEntry[] {
    if (!this.store.getById(id)) throw new HttpError(404, 'Share link not found.');
    return this.store.getAccessLog(id, limit);
  }
}
