import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import { generateSecret } from './crypto.js';
import type { AuthRecord } from './types.js';

/**
 * Owns auth.json — same pattern as settings/store.ts (in-memory cache,
 * writes serialized through one promise chain, atomic write-then-rename):
 * there's no external system authoritative for this, so the file is the only
 * source of truth. `cache` has three states: undefined (not loaded yet),
 * null (loaded, no account configured), or a record.
 *
 * Deliberately does NOT reuse settings/store.ts's update() shape verbatim:
 * that method's queued closure never throws, but create() here must (409 if
 * already configured) to serialize concurrent setup attempts. Letting a
 * rejection become the new writeQueue would poison every later write forever
 * (any .then() chained onto an already-rejected promise short-circuits) — so
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
      // Regenerating the secret invalidates every existing session cookie —
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
