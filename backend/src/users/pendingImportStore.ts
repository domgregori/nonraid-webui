import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

export interface PendingImportUser {
  username: string;
  // Carried through from the originating ParsedShare's readUsers/writeUsers (see unraidImport/
  // parser.ts) so setUserAccess() can be applied the moment this user is actually created -
  // whenever that ends up being, possibly a completely separate session from the import itself.
  readShares: string[];
  writeShares: string[];
}

/**
 * pending-import-users.json - Unraid users found during an "Import from Unraid" run, parked here
 * for the admin to review on the Users page rather than created immediately. Unlike the shares
 * half of that same import (created outright, since a share needs no secret), a user needs a real
 * new password chosen by a person - this store is exactly the queue for that, one entry per
 * username, until it's either created (see UsersService.createUser, which removes it) or
 * explicitly discarded. Same write-queue + atomic-rename shape as ShareAccessStore, for the same
 * "no external system holds this, this file is authoritative" reason.
 */
export class PendingImportUsersStore {
  private cache: PendingImportUser[] | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private filePath: string = config.pendingImportUsersConfigPath) {}

  async getAll(): Promise<PendingImportUser[]> {
    return structuredClone(await this.load());
  }

  /** Adds/merges entries from a fresh import - a username already pending gets its share lists
   *  unioned rather than duplicated, so importing the same backup twice (or two overlapping
   *  backups) doesn't produce two rows for the same user. */
  addMany(entries: PendingImportUser[]): Promise<void> {
    return this.mutate((all) => {
      const byName = new Map(all.map((u) => [u.username, u]));
      for (const entry of entries) {
        const existing = byName.get(entry.username);
        if (existing) {
          existing.readShares = [...new Set([...existing.readShares, ...entry.readShares])];
          existing.writeShares = [...new Set([...existing.writeShares, ...entry.writeShares])];
        } else {
          byName.set(entry.username, entry);
        }
      }
      return [...byName.values()];
    });
  }

  /** Called once a pending user is created for real, or explicitly discarded. */
  remove(username: string): Promise<void> {
    return this.mutate((all) => all.filter((u) => u.username !== username));
  }

  private async load(): Promise<PendingImportUser[]> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.cache = JSON.parse(raw) as PendingImportUser[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = [];
      } else {
        throw err;
      }
    }
    return this.cache;
  }

  private mutate(fn: (all: PendingImportUser[]) => PendingImportUser[]): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const all = await this.load();
      await this.persistAtomic(fn(all));
    });
    return this.writeQueue;
  }

  private async persistAtomic(all: PendingImportUser[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
    await rename(tmp, this.filePath);
    this.cache = all;
  }
}
