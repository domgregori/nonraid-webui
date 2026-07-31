import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { CaFeed } from './types.js';

/**
 * Owns the cached Community Applications feed. The feed is ~20MB of JSON
 * hosted by the CA maintainers (not an official public API) — this fetches it
 * on startup, persists it to disk so a restart doesn't require re-fetching
 * immediately, and refreshes on a long background interval rather than per
 * request. The primary URL is Unraid's own CDN; the GitHub-hosted mirror is
 * used as a fallback if that's unreachable.
 */
export class CaFeedStore {
  private cache: CaFeed | null = null;
  private fetchedAt = 0;
  private refreshTimer: NodeJS.Timeout | null = null;
  private inFlight: Promise<CaFeed> | null = null;

  constructor(
    private filePath: string = config.appsFeedCachePath,
    private primaryUrl: string = config.appsFeedPrimaryUrl,
    private backupUrl: string = config.appsFeedBackupUrl,
    private refreshIntervalMs: number = config.appsFeedRefreshIntervalMs,
  ) {}

  async start(): Promise<void> {
    await this.load();
    this.refreshTimer = setInterval(() => {
      this.refresh().catch((err) => console.error('CA feed background refresh failed:', (err as Error).message));
    }, this.refreshIntervalMs);
    this.refreshTimer.unref?.();
  }

  stop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  async getFeed(): Promise<CaFeed> {
    return this.load();
  }

  get lastFetchedAt(): number {
    return this.fetchedAt;
  }

  /** Force a fetch now, bypassing the disk cache. Used by the manual "Refresh" action. */
  async refresh(): Promise<CaFeed> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.fetchAndPersist();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async load(): Promise<CaFeed> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.cache = JSON.parse(raw) as CaFeed;
      return this.cache;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('CA feed cache on disk is unreadable, re-fetching:', (err as Error).message);
      }
      return this.refresh();
    }
  }

  private async fetchAndPersist(): Promise<CaFeed> {
    const feed = await this.fetchFeed();
    this.cache = feed;
    this.fetchedAt = Date.now();
    await this.persistAtomic(feed);
    return feed;
  }

  private async fetchFeed(): Promise<CaFeed> {
    try {
      return await this.fetchUrl(this.primaryUrl);
    } catch (err) {
      console.error(`CA feed primary URL failed (${(err as Error).message}), trying backup mirror`);
      return this.fetchUrl(this.backupUrl);
    }
  }

  private async fetchUrl(url: string): Promise<CaFeed> {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`${url} responded ${res.status}`);
    return (await res.json()) as CaFeed;
  }

  private async persistAtomic(feed: CaFeed): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify(feed), 'utf8');
    await rename(tmp, this.filePath);
  }
}
