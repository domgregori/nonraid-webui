import { config } from '../config.js';
import type { SmartClient, SmartHealth } from './types.js';

interface CacheEntry<T> {
  value: T;
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
  private tempCache = new Map<string, CacheEntry<number | null>>();
  private tempInFlight = new Map<string, Promise<void>>();
  private healthCache = new Map<string, CacheEntry<SmartHealth | null>>();
  private healthInFlight = new Map<string, Promise<void>>();

  constructor(
    private client: SmartClient,
    private ttlMs: number = config.smartCacheTtlMs,
  ) {}

  get mode() {
    return this.client.mode;
  }

  async getTemperatures(devices: string[]): Promise<Record<string, number | null>> {
    return this.getCached(devices, this.tempCache, this.tempInFlight, (d) => this.client.getTemperature(d));
  }

  async getHealthStatuses(devices: string[]): Promise<Record<string, SmartHealth | null>> {
    return this.getCached(devices, this.healthCache, this.healthInFlight, (d) => this.client.getHealth(d));
  }

  /** Stale-while-revalidate fetch, shared by temperature and health reads — see SmartService's doc comment. */
  private async getCached<T>(
    devices: string[],
    cache: Map<string, CacheEntry<T>>,
    inFlight: Map<string, Promise<void>>,
    fetch: (device: string) => Promise<T>,
    fallback: T = null as T,
  ): Promise<Record<string, T>> {
    const now = Date.now();
    const toAwait: Promise<void>[] = [];

    for (const device of devices) {
      const entry = cache.get(device);
      const stale = !entry || now - entry.updatedAt > this.ttlMs;
      if (!stale) continue;

      const pending = inFlight.get(device);
      if (pending) {
        if (!entry) toAwait.push(pending); // cold: wait so we don't return undefined
        continue;
      }

      const refresh = fetch(device)
        .then((value) => {
          cache.set(device, { value, updatedAt: Date.now() });
        })
        .catch(() => {
          cache.set(device, { value: fallback, updatedAt: Date.now() });
        })
        .finally(() => {
          inFlight.delete(device);
        });

      inFlight.set(device, refresh);
      if (!entry) toAwait.push(refresh); // no cached value yet — must wait
    }

    if (toAwait.length > 0) await Promise.all(toAwait);

    const result: Record<string, T> = {};
    for (const device of devices) {
      result[device] = cache.get(device)?.value ?? fallback;
    }
    return result;
  }
}
