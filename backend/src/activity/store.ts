import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { ActivityColor, ActivityEntry } from './types.js';

// Keeps the file bounded - this is a rolling recent-activity feed, not an
// audit log; nothing currently reads or needs entries past this.
const MAX_ENTRIES = 500;
const DEFAULT_LIST_LIMIT = 20;

/**
 * Owns activity.json - mirrors shares/store.ts and settings/store.ts's
 * pattern (in-memory cache, writes serialized through one promise chain,
 * atomic write-then-rename) for the same reason: nothing else is
 * authoritative for "what happened recently," so this file is the only
 * source of truth. Entries are stored newest-first so `list()` is a plain
 * slice, no sort needed on the read path.
 */
export class ActivityStore {
  private cache: ActivityEntry[] | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private filePath: string = config.activityConfigPath) {}

  async list(limit: number = DEFAULT_LIST_LIMIT): Promise<ActivityEntry[]> {
    return (await this.load()).slice(0, limit);
  }

  /**
   * Fire-and-forget from every call site's point of view - logging a real
   * action's outcome should never be the reason that action's own request
   * fails, so callers are expected to `.catch(() => {})` this rather than
   * let a rare disk-write failure mask a successful array start/share
   * create/etc. as an error.
   */
  log(text: string, color: ActivityColor = 'blue'): Promise<void> {
    const entry: ActivityEntry = { id: randomUUID(), timestamp: Date.now(), text, color };
    this.writeQueue = this.writeQueue.then(async () => {
      const next = [entry, ...(await this.load())].slice(0, MAX_ENTRIES);
      await this.persistAtomic(next);
    });
    return this.writeQueue;
  }

  private async load(): Promise<ActivityEntry[]> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.cache = JSON.parse(raw) as ActivityEntry[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = [];
      } else {
        throw err;
      }
    }
    return this.cache;
  }

  private async persistAtomic(entries: ActivityEntry[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify(entries, null, 2), 'utf8');
    await rename(tmp, this.filePath);
    this.cache = entries;
  }
}
