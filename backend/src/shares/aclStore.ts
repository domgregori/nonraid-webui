import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { ShareAccess, SharePermission } from './types.js';

type PrincipalType = 'users' | 'groups';

/**
 * Owns share-access.json — desired per-user/per-group SMB permission for every
 * share. Same rationale as ShareStore: no external system holds this as data (smb.conf
 * is generated *from* it, not the other way around), so this file is authoritative.
 * Same write-queue + atomic-rename approach as ShareStore for the same reason.
 */
export class ShareAccessStore {
  private cache: Record<string, ShareAccess> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private filePath: string = config.shareAccessConfigPath) {}

  async getAll(): Promise<Record<string, ShareAccess>> {
    return structuredClone(await this.load());
  }

  async get(shareName: string): Promise<ShareAccess> {
    return structuredClone((await this.load())[shareName] ?? { users: {}, groups: {} });
  }

  setEntry(shareName: string, principalType: PrincipalType, principal: string, permission: SharePermission): Promise<void> {
    return this.mutate((all) => {
      const entry = all[shareName] ?? { users: {}, groups: {} };
      entry[principalType][principal] = permission;
      all[shareName] = entry;
      return all;
    });
  }

  /** Called when a share is deleted — drops its whole access list. */
  removeShare(shareName: string): Promise<void> {
    return this.mutate((all) => {
      delete all[shareName];
      return all;
    });
  }

  /** Called when a user or group is deleted — drops every reference to it, across every share. */
  removePrincipal(principalType: PrincipalType, principal: string): Promise<void> {
    return this.mutate((all) => {
      for (const entry of Object.values(all)) {
        delete entry[principalType][principal];
      }
      return all;
    });
  }

  private async load(): Promise<Record<string, ShareAccess>> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.cache = JSON.parse(raw) as Record<string, ShareAccess>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = {};
      } else {
        throw err;
      }
    }
    return this.cache;
  }

  private mutate(fn: (all: Record<string, ShareAccess>) => Record<string, ShareAccess>): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const all = await this.load();
      await this.persistAtomic(fn(all));
    });
    return this.writeQueue;
  }

  private async persistAtomic(all: Record<string, ShareAccess>): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
    await rename(tmp, this.filePath);
    this.cache = all;
  }
}
