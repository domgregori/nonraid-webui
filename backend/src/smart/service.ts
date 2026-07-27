import { config } from '../config.js';
import type { SmartClient } from './types.js';

interface CacheEntry {
  tempC: number | null;
  updatedAt: number;
}

/**
 * Caches per-device SMART temperature reads. smartctl takes real wall-clock
 * time per call (even more with -n standby's early-exit check), so we don't
 * want every /api/status poll to shell out to it for every disk. Serves
 * cached values immediately and refreshes in the background once stale
 * (stale-while-revalidate) — except on first request for a device, which
 * waits for the real read so callers don't get a wall of nulls on cold start.
 */
export class SmartService {
  private cache = new Map<string, CacheEntry>();
  private inFlight = new Map<string, Promise<void>>();

  constructor(
    private client: SmartClient,
    private ttlMs: number = config.smartCacheTtlMs,
  ) {}

  get mode() {
    return this.client.mode;
  }

  async getTemperatures(devices: string[]): Promise<Record<string, number | null>> {
    const now = Date.now();
    const toAwait: Promise<void>[] = [];

    for (const device of devices) {
      const entry = this.cache.get(device);
      const stale = !entry || now - entry.updatedAt > this.ttlMs;
      if (!stale) continue;

      const pending = this.inFlight.get(device);
      if (pending) {
        if (!entry) toAwait.push(pending); // cold: wait so we don't return undefined
        continue;
      }

      const refresh = this.client
        .getTemperature(device)
        .then((tempC) => {
          this.cache.set(device, { tempC, updatedAt: Date.now() });
        })
        .catch(() => {
          this.cache.set(device, { tempC: null, updatedAt: Date.now() });
        })
        .finally(() => {
          this.inFlight.delete(device);
        });

      this.inFlight.set(device, refresh);
      if (!entry) toAwait.push(refresh); // no cached value yet — must wait
    }

    if (toAwait.length > 0) await Promise.all(toAwait);

    const result: Record<string, number | null> = {};
    for (const device of devices) {
      result[device] = this.cache.get(device)?.tempC ?? null;
    }
    return result;
  }
}
