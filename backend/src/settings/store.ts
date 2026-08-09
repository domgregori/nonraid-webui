import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { AppSettings, AppSettingsUpdate } from './types.js';

const DEFAULTS: AppSettings = {
  turboWrite: false,
  notifications: { enabled: false, appriseUrls: '' },
  minFreeSpaceMb: 100,
  paritySchedule: { enabled: false, dayOfWeek: 0, hour: 2 },
};

/**
 * Owns settings.json — mirrors shares/store.ts's pattern (in-memory cache,
 * writes serialized through one promise chain, atomic write-then-rename) for
 * the same reason: there's no external system that's authoritative for these
 * values, so this file is the only source of truth.
 */
export class SettingsStore {
  private cache: AppSettings | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private filePath: string = config.settingsConfigPath) {}

  async get(): Promise<AppSettings> {
    const settings = await this.load();
    return { ...settings, notifications: { ...settings.notifications }, paritySchedule: { ...settings.paritySchedule } };
  }

  update(patch: AppSettingsUpdate): Promise<AppSettings> {
    this.writeQueue = this.writeQueue.then(async () => {
      const current = await this.load();
      const next: AppSettings = {
        ...current,
        ...patch,
        notifications: { ...current.notifications, ...patch.notifications },
        paritySchedule: { ...current.paritySchedule, ...patch.paritySchedule },
      };
      await this.persistAtomic(next);
    });
    return this.writeQueue.then(() => this.get());
  }

  private async load(): Promise<AppSettings> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      this.cache = {
        ...DEFAULTS,
        ...parsed,
        notifications: { ...DEFAULTS.notifications, ...parsed.notifications },
        paritySchedule: { ...DEFAULTS.paritySchedule, ...parsed.paritySchedule },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = { ...DEFAULTS };
      } else {
        throw err;
      }
    }
    return this.cache;
  }

  private async persistAtomic(settings: AppSettings): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
    await rename(tmp, this.filePath);
    this.cache = settings;
  }
}
