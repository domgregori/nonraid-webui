import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import type { TlsRecord } from './types.js';

/**
 * Owns tls.json - same pattern as auth/store.ts (in-memory cache with three states: undefined
 * not loaded yet, null loaded with no cert configured yet, or a record; writes serialized
 * through one promise chain; atomic write-then-rename). The cert/key PEM files themselves live
 * on disk under config.tlsCertDir - this store only tracks metadata/paths, never key material.
 */
export class TlsStore {
  private cache: TlsRecord | null | undefined;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private filePath: string = config.tlsConfigPath) {}

  async get(): Promise<TlsRecord | null> {
    return this.load();
  }

  // Called after generating or importing a certificate - replaces the cert/key material and
  // metadata, but deliberately preserves whatever `enabled` was already set to (a re-generated
  // or re-imported cert shouldn't silently flip TLS on, nor silently turn off a currently-enabled
  // deployment - both are separate, explicit actions via setEnabled).
  setCert(fields: Omit<TlsRecord, 'enabled'>): Promise<TlsRecord> {
    const result = this.writeQueue.then(async () => {
      const current = await this.load();
      const record: TlsRecord = { enabled: current?.enabled ?? false, ...fields };
      await this.persistAtomic(record);
      return record;
    });
    this.writeQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  setEnabled(enabled: boolean): Promise<TlsRecord> {
    const result = this.writeQueue.then(async () => {
      const current = await this.load();
      if (!current) throw new HttpError(409, 'Generate or import a certificate first.');
      const record: TlsRecord = { ...current, enabled };
      await this.persistAtomic(record);
      return record;
    });
    this.writeQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private async load(): Promise<TlsRecord | null> {
    if (this.cache !== undefined) return this.cache;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.cache = JSON.parse(raw) as TlsRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = null;
      } else {
        throw err;
      }
    }
    return this.cache;
  }

  private async persistAtomic(record: TlsRecord): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify(record, null, 2), 'utf8');
    await rename(tmp, this.filePath);
    this.cache = record;
  }
}
