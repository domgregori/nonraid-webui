import { createHash, randomUUID } from 'node:crypto';
import { generateShareToken, hashSecret } from '../auth/crypto.js';
import { resolveExisting } from '../browse/paths.js';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import { decryptToken, encryptToken } from './tokenCrypto.js';
import { ShareLinkStore, type ShareLinkAccessLogEntry, type ShareLinkRecord, type ShareMode, type UpdateShareLinkInput } from './store.js';

// Admin-facing update shape, mirroring CreateShareLinkOptions below - `password` is plaintext
// (hashed here, same as create()), unlike the store-level UpdateShareLinkInput's `passwordHash`.
export interface UpdateShareLinkOptions {
  label?: string | null;
  expiresAt?: number | null;
  revoked?: boolean;
  mode?: ShareMode;
  allowDelete?: boolean;
  password?: string | null;
  uploadQuotaBytes?: number | null;
  maxFileSizeBytes?: number | null;
}

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

// The admin-facing shape of a share link - never includes tokenHash or passwordHash (the
// password itself is never kept past the one hashSecret() call at creation time; `hasPassword`
// tells the UI whether one was set, without exposing the hash). `token` IS included, and stays
// retrievable for the life of the share (see tokenCrypto.ts's doc comment for why a reversible
// encryption-at-rest, not a one-way hash, is the right call for this particular credential) - the
// admin can view/copy the link again anytime from the Edit Link view, not just once at creation.
export type PublicShareLink = Omit<ShareLinkRecord, 'tokenHash' | 'tokenEncrypted' | 'passwordHash'> & { hasPassword: boolean; token: string };

// Kept as an alias so existing call sites/imports don't need to change - creation and every other
// read now return the identical shape, there's no more "only returned once" special case.
export type CreatedShareLink = PublicShareLink;

function toPublic(record: ShareLinkRecord): PublicShareLink {
  const { tokenHash: _tokenHash, tokenEncrypted, passwordHash, ...rest } = record;
  return { ...rest, hasPassword: passwordHash !== null, token: decryptToken(tokenEncrypted, config.shareTokenKeyPath) };
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
    const tokenEncrypted = encryptToken(token, config.shareTokenKeyPath);
    const passwordHash = opts.password ? await hashSecret(opts.password) : null;
    const id = randomUUID();

    const record = this.store.create({
      id,
      tokenHash,
      tokenEncrypted,
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

    return toPublic(record);
  }

  list(): PublicShareLink[] {
    return this.store.list().map(toPublic);
  }

  async update(id: string, patch: UpdateShareLinkOptions): Promise<PublicShareLink> {
    if (!this.store.getById(id)) throw new HttpError(404, 'Share link not found.');
    if (patch.mode !== undefined && patch.mode !== 'read-only' && patch.mode !== 'upload-only' && patch.mode !== 'editable') {
      throw new HttpError(400, 'mode must be "read-only", "upload-only", or "editable".');
    }
    const storePatch: UpdateShareLinkInput = {
      label: patch.label,
      expiresAt: patch.expiresAt,
      revoked: patch.revoked,
      mode: patch.mode,
      allowDelete: patch.allowDelete,
      uploadQuotaBytes: patch.uploadQuotaBytes,
      maxFileSizeBytes: patch.maxFileSizeBytes,
    };
    // undefined = leave as-is; null = clear the password (share becomes passwordless); a non-empty
    // string = hash it as the new password - same three-way distinction create() draws, just at
    // update time instead of creation time.
    if (patch.password !== undefined) {
      storePatch.passwordHash = patch.password === null || patch.password === '' ? null : await hashSecret(patch.password);
    }
    const updated = this.store.update(id, storePatch);
    if (!updated) throw new HttpError(404, 'Share link not found.');
    return toPublic(updated);
  }

  // Permanently forgets a share link, not just marks it revoked - only ever allowed once the
  // share is already unreachable (revoked, or past its own expiresAt), same "narrows/tidies up
  // access, never grants it" reasoning update()'s own step-up exemption rests on. A live share
  // must be revoked first - this refuses rather than silently revoking-then-deleting on the
  // caller's behalf, so a delete always means exactly what it says.
  remove(id: string): void {
    const record = this.store.getById(id);
    if (!record) throw new HttpError(404, 'Share link not found.');
    const live = record.revokedAt === null && (record.expiresAt === null || record.expiresAt > Date.now());
    if (live) throw new HttpError(409, 'Revoke this share link before deleting it.');
    this.store.remove(id);
  }

  getActivity(id: string, limit?: number): ShareLinkAccessLogEntry[] {
    if (!this.store.getById(id)) throw new HttpError(404, 'Share link not found.');
    return this.store.getAccessLog(id, limit);
  }
}
