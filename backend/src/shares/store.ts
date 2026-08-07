import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { Share } from './types.js';

/**
 * Owns shares.json — the source of truth for what shares should exist (there's
 * no external system to treat as authoritative here, unlike nmd/docker/smart).
 * Writes are serialized through one promise chain so
 * concurrent requests can't interleave and corrupt the file, and each write is
 * atomic (write to a temp file, then rename) so a crash mid-write can't leave a
 * truncated/corrupt shares.json behind.
 */
export class ShareStore {
  private cache: Share[] | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private filePath: string = config.sharesConfigPath) {}

  async list(): Promise<Share[]> {
    return [...(await this.load())];
  }

  async get(name: string): Promise<Share | undefined> {
    return (await this.load()).find((s) => s.name === name);
  }

  upsert(share: Share): Promise<void> {
    return this.mutate((shares) => {
      const idx = shares.findIndex((s) => s.name === share.name);
      if (idx >= 0) shares[idx] = share;
      else shares.push(share);
      return shares;
    });
  }

  remove(name: string): Promise<void> {
    return this.mutate((shares) => shares.filter((s) => s.name !== name));
  }

  private async load(): Promise<Share[]> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.cache = JSON.parse(raw) as Share[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = [];
      } else {
        throw err;
      }
    }
    return this.cache;
  }

  private mutate(fn: (shares: Share[]) => Share[]): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const shares = await this.load();
      await this.persistAtomic(fn(shares));
    });
    return this.writeQueue;
  }

  private async persistAtomic(shares: Share[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify(shares, null, 2), 'utf8');
    await rename(tmp, this.filePath);
    this.cache = shares;
  }
}
