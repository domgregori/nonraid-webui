import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import { generateSecret, verifySecret } from './crypto.js';
import type { ApiToken, ApiTokenScope, AuthRecord, PasskeyCredential, TotpBackupCode } from './types.js';

/**
 * Owns auth.json - same pattern as settings/store.ts (in-memory cache,
 * writes serialized through one promise chain, atomic write-then-rename):
 * there's no external system authoritative for this, so the file is the only
 * source of truth. `cache` has three states: undefined (not loaded yet),
 * null (loaded, no account configured), or a record.
 *
 * Deliberately does NOT reuse settings/store.ts's update() shape verbatim:
 * that method's queued closure never throws, but create() here must (409 if
 * already configured) to serialize concurrent setup attempts. Letting a
 * rejection become the new writeQueue would poison every later write forever
 * (any .then() chained onto an already-rejected promise short-circuits) - so
 * the promise returned to the caller and the one stored as the next
 * writeQueue are kept separate, and the stored one is always normalized to
 * resolve.
 */
export class AuthStore {
  private cache: AuthRecord | null | undefined;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private filePath: string = config.authConfigPath) {}

  async get(): Promise<AuthRecord | null> {
    return this.load();
  }

  create(username: string, passwordHash: string): Promise<AuthRecord> {
    const result = this.writeQueue.then(async () => {
      const current = await this.load();
      if (current) {
        throw new HttpError(409, 'An admin account is already configured.');
      }
      const record: AuthRecord = { username, passwordHash, sessionSecret: generateSecret() };
      await this.persistAtomic(record);
      return record;
    });
    this.writeQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  updatePassword(passwordHash: string): Promise<AuthRecord> {
    const result = this.writeQueue.then(async () => {
      const current = await this.load();
      if (!current) {
        throw new HttpError(409, 'No admin account is configured yet.');
      }
      // Regenerating the secret invalidates every existing session cookie -
      // this is what makes a password change also mean "log out everywhere",
      // the only revocation mechanism this stateless-cookie design has.
      const record: AuthRecord = { ...current, passwordHash, sessionSecret: generateSecret() };
      await this.persistAtomic(record);
      return record;
    });
    this.writeQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  setPendingTotp(secret: string): Promise<AuthRecord> {
    const result = this.writeQueue.then(async () => {
      const current = await this.load();
      if (!current) throw new HttpError(409, 'No admin account is configured yet.');
      const record: AuthRecord = { ...current, pendingTotp: { secret, createdAt: Date.now() } };
      await this.persistAtomic(record);
      return record;
    });
    this.writeQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  confirmTotp(backupCodes: TotpBackupCode[]): Promise<AuthRecord> {
    const result = this.writeQueue.then(async () => {
      const current = await this.load();
      if (!current) throw new HttpError(409, 'No admin account is configured yet.');
      if (!current.pendingTotp) throw new HttpError(409, 'No pending two-factor enrollment to confirm.');
      const { pendingTotp, ...rest } = current;
      const record: AuthRecord = { ...rest, totp: { secret: pendingTotp.secret, confirmedAt: Date.now(), backupCodes } };
      await this.persistAtomic(record);
      return record;
    });
    this.writeQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  disableTotp(): Promise<AuthRecord> {
    const result = this.writeQueue.then(async () => {
      const current = await this.load();
      if (!current) throw new HttpError(409, 'No admin account is configured yet.');
      const { totp: _totp, ...rest } = current;
      const record: AuthRecord = { ...rest };
      await this.persistAtomic(record);
      return record;
    });
    this.writeQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  regenerateBackupCodes(codes: TotpBackupCode[]): Promise<AuthRecord> {
    const result = this.writeQueue.then(async () => {
      const current = await this.load();
      if (!current) throw new HttpError(409, 'No admin account is configured yet.');
      if (!current.totp) throw new HttpError(409, 'Two-factor authentication is not enabled.');
      const record: AuthRecord = { ...current, totp: { ...current.totp, backupCodes: codes } };
      await this.persistAtomic(record);
      return record;
    });
    this.writeQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  // Verify-and-mark-used happen inside this one queued closure, not as a separate read-then-write
  // from the service layer - doing it in two steps would let two concurrent requests both pass
  // verification against the same still-unused code before either write lands, double-spending a
  // single-use code. Serializing through writeQueue (the same mechanism every other mutation here
  // already uses) closes that race for free.
  consumeBackupCodeIfValid(plainCode: string): Promise<boolean> {
    const result = this.writeQueue.then(async () => {
      const current = await this.load();
      if (!current?.totp) return false;
      let consumed = false;
      const backupCodes: TotpBackupCode[] = [];
      for (const entry of current.totp.backupCodes) {
        if (!consumed && entry.usedAt === null && (await verifySecret(plainCode, entry.hash))) {
          backupCodes.push({ ...entry, usedAt: Date.now() });
          consumed = true;
        } else {
          backupCodes.push(entry);
        }
      }
      if (!consumed) return false;
      const record: AuthRecord = { ...current, totp: { ...current.totp, backupCodes } };
      await this.persistAtomic(record);
      return true;
    });
    this.writeQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  addPasskey(credential: PasskeyCredential): Promise<AuthRecord> {
    const result = this.writeQueue.then(async () => {
      const current = await this.load();
      if (!current) throw new HttpError(409, 'No admin account is configured yet.');
      const record: AuthRecord = { ...current, passkeys: [...(current.passkeys ?? []), credential] };
      await this.persistAtomic(record);
      return record;
    });
    this.writeQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  removePasskey(id: string): Promise<AuthRecord> {
    const result = this.writeQueue.then(async () => {
      const current = await this.load();
      if (!current) throw new HttpError(409, 'No admin account is configured yet.');
      const existing = current.passkeys ?? [];
      if (!existing.some((p) => p.id === id)) {
        throw new HttpError(404, 'No passkey with that ID.');
      }
      const record: AuthRecord = { ...current, passkeys: existing.filter((p) => p.id !== id) };
      await this.persistAtomic(record);
      return record;
    });
    this.writeQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  // Bumped after every successful authentication - WebAuthn's own clone-detection mechanism.
  updatePasskeyCounter(id: string, counter: number): Promise<AuthRecord> {
    const result = this.writeQueue.then(async () => {
      const current = await this.load();
      if (!current) throw new HttpError(409, 'No admin account is configured yet.');
      const existing = current.passkeys ?? [];
      const record: AuthRecord = { ...current, passkeys: existing.map((p) => (p.id === id ? { ...p, counter } : p)) };
      await this.persistAtomic(record);
      return record;
    });
    this.writeQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  // --- API tokens ---

  createApiToken(name: string, hash: string, scope: ApiTokenScope): Promise<ApiToken> {
    const result = this.writeQueue.then(async () => {
      const current = await this.load();
      if (!current) throw new HttpError(409, 'No admin account is configured yet.');
      const token: ApiToken = { id: randomUUID(), name, hash, scope, createdAt: Date.now(), lastUsedAt: null };
      const record: AuthRecord = { ...current, apiTokens: [...(current.apiTokens ?? []), token] };
      await this.persistAtomic(record);
      return token;
    });
    this.writeQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  revokeApiToken(id: string): Promise<void> {
    const result = this.writeQueue.then(async () => {
      const current = await this.load();
      if (!current) throw new HttpError(409, 'No admin account is configured yet.');
      const existing = current.apiTokens ?? [];
      if (!existing.some((t) => t.id === id)) {
        throw new HttpError(404, 'No API token with that ID.');
      }
      const record: AuthRecord = { ...current, apiTokens: existing.filter((t) => t.id !== id) };
      await this.persistAtomic(record);
    });
    this.writeQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  // Best-effort, called on every bearer-token-authenticated request (see
  // AuthService.isAuthenticated) - callers deliberately never await this, so it must never throw
  // in a way that could surface as an unhandled rejection. Silently no-ops if the token was
  // revoked between verifying it and this write landing.
  touchApiToken(id: string): Promise<void> {
    const result = this.writeQueue.then(async () => {
      const current = await this.load();
      if (!current) return;
      const existing = current.apiTokens ?? [];
      if (!existing.some((t) => t.id === id)) return;
      const record: AuthRecord = { ...current, apiTokens: existing.map((t) => (t.id === id ? { ...t, lastUsedAt: Date.now() } : t)) };
      await this.persistAtomic(record);
    });
    this.writeQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private async load(): Promise<AuthRecord | null> {
    if (this.cache !== undefined) return this.cache;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.cache = JSON.parse(raw) as AuthRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = null;
      } else {
        throw err;
      }
    }
    return this.cache;
  }

  private async persistAtomic(record: AuthRecord): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify(record, null, 2), 'utf8');
    await rename(tmp, this.filePath);
    this.cache = record;
  }
}
