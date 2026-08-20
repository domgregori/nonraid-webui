import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { SyncJob } from './types.js';

export type NewSyncJob = Omit<SyncJob, 'id' | 'lastSyncedAt' | 'lastSizeBytes' | 'lastFileCount' | 'lastErrorCount' | 'lastError'>;
export type SyncJobPatch = Partial<Omit<SyncJob, 'id'>>;

/**
 * Owns rclone-sync-jobs.json - the repeatable list of Remote Backup sync jobs. Same atomic
 * write-then-rename/in-memory-cache/serialized-write-queue shape as settings/store.ts and
 * shares/store.ts, just for a list instead of a single object, since this is a growing collection
 * of structured records (add/edit/remove any one of them) rather than one feature's settings.
 */
export class SyncJobStore {
  private cache: SyncJob[] | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private filePath: string = config.rcloneSyncJobsConfigPath) {}

  async list(): Promise<SyncJob[]> {
    return (await this.load()).map((j) => ({ ...j, schedule: { ...j.schedule }, retention: { ...j.retention } }));
  }

  async get(id: string): Promise<SyncJob | null> {
    const jobs = await this.load();
    const job = jobs.find((j) => j.id === id);
    return job ? { ...job, schedule: { ...job.schedule }, retention: { ...job.retention } } : null;
  }

  create(job: NewSyncJob): Promise<SyncJob> {
    const newJob: SyncJob = { ...job, id: randomUUID(), lastSyncedAt: null, lastSizeBytes: null, lastFileCount: null, lastErrorCount: null, lastError: null };
    this.writeQueue = this.writeQueue.then(async () => {
      const jobs = await this.load();
      await this.persistAtomic([...jobs, newJob]);
    });
    return this.writeQueue.then(() => newJob);
  }

  update(id: string, patch: SyncJobPatch): Promise<SyncJob> {
    this.writeQueue = this.writeQueue.then(async () => {
      const jobs = await this.load();
      const idx = jobs.findIndex((j) => j.id === id);
      if (idx === -1) throw new Error(`No sync job with id "${id}".`);
      const existing = jobs[idx]!;
      const next: SyncJob = {
        ...existing,
        ...patch,
        schedule: { ...existing.schedule, ...patch.schedule },
        retention: { ...existing.retention, ...patch.retention },
      };
      const updated = [...jobs];
      updated[idx] = next;
      await this.persistAtomic(updated);
    });
    return this.writeQueue.then(async () => (await this.get(id))!);
  }

  delete(id: string): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const jobs = await this.load();
      await this.persistAtomic(jobs.filter((j) => j.id !== id));
    });
    return this.writeQueue;
  }

  private async load(): Promise<SyncJob[]> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.cache = JSON.parse(raw) as SyncJob[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = [];
      } else {
        throw err;
      }
    }
    return this.cache;
  }

  private async persistAtomic(jobs: SyncJob[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify(jobs, null, 2), 'utf8');
    await rename(tmp, this.filePath);
    this.cache = jobs;
  }
}
