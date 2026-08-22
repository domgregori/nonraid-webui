import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartService } from './service.js';
import { createFakeSmartClient, smartAttributesFixture } from '../test/fakeSmartClient.js';
import type { SmartHealth } from './types.js';

async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('SmartService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('temperature cache', () => {
    it('cold start waits for the real read and serves it back from cache within TTL', async () => {
      const temps = vi.fn(async (): Promise<number | null> => 38);
      const svc = new SmartService(createFakeSmartClient({ getTemperature: temps }), 60_000, 4_000);

      const first = await svc.getTemperatures(['sda']);
      expect(first).toEqual({ sda: 38 });
      expect(temps).toHaveBeenCalledTimes(1);

      const second = await svc.getTemperatures(['sda']);
      expect(second).toEqual({ sda: 38 });
      expect(temps).toHaveBeenCalledTimes(1);
    });

    it('does not refresh before TTL elapses', async () => {
      const temps = vi.fn(async (): Promise<number | null> => 38);
      const svc = new SmartService(createFakeSmartClient({ getTemperature: temps }), 60_000, 4_000);

      await svc.getTemperatures(['sda']);
      vi.advanceTimersByTime(59_999);
      await svc.getTemperatures(['sda']);
      expect(temps).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2);
      await svc.getTemperatures(['sda']);
      expect(temps).toHaveBeenCalledTimes(2);
    });

    it('serves the stale value while a background refresh runs after TTL (stale-while-revalidate)', async () => {
      // A fresh deferred per client call, so the second (background) read is still pending
      // when we assert the stale value, then resolves to a newer value.
      const resolvers: Array<(v: number | null) => void> = [];
      const temps = vi.fn(() => new Promise<number | null>((res) => resolvers.push(res)));
      const svc = new SmartService(createFakeSmartClient({ getTemperature: temps }), 60_000, 4_000);

      // Cold: must wait for the first real read.
      const cold = svc.getTemperatures(['sda']);
      resolvers[0]?.(41);
      await expect(cold).resolves.toEqual({ sda: 41 });
      expect(temps).toHaveBeenCalledTimes(1);

      // Expire the TTL.
      vi.advanceTimersByTime(60_001);

      // Stale-while-revalidate: the stale cached value is returned immediately,
      // while a background refresh starts for the second device read.
      await expect(svc.getTemperatures(['sda'])).resolves.toEqual({ sda: 41 });
      expect(temps).toHaveBeenCalledTimes(2);

      // Complete the background refresh, then the fresh value is served from cache.
      resolvers[1]?.(42);
      await flushMicrotasks();
      await expect(svc.getTemperatures(['sda'])).resolves.toEqual({ sda: 42 });
      expect(temps).toHaveBeenCalledTimes(2);
    });

    it('dedupes concurrent cold reads for the same device into one underlying read', async () => {
      const read = deferred<number | null>();
      const temps = vi.fn(() => read.promise);
      const svc = new SmartService(createFakeSmartClient({ getTemperature: temps }), 60_000, 4_000);

      const p1 = svc.getTemperatures(['sda']);
      const p2 = svc.getTemperatures(['sda']);
      expect(temps).toHaveBeenCalledTimes(1);

      read.resolve(38);
      await expect(p1).resolves.toEqual({ sda: 38 });
      await expect(p2).resolves.toEqual({ sda: 38 });
      expect(temps).toHaveBeenCalledTimes(1);
    });

    it('falls back to null when a cold read fails', async () => {
      const temps = vi.fn(async (): Promise<number | null> => {
        throw new Error('device asleep');
      });
      const svc = new SmartService(createFakeSmartClient({ getTemperature: temps }), 60_000, 4_000);

      await expect(svc.getTemperatures(['sda'])).resolves.toEqual({ sda: null });
    });
  });

  describe('health cache', () => {
    it('caches health separately from temperature', async () => {
      const health = vi.fn(async (): Promise<SmartHealth | null> => 'passed');
      const svc = new SmartService(createFakeSmartClient({ getHealth: health }), 60_000, 4_000);

      await svc.getHealthStatuses(['sda']);
      await svc.getHealthStatuses(['sda']);
      expect(health).toHaveBeenCalledTimes(1);
    });
  });

  describe('attribute cache', () => {
    it('startSelfTest invalidates the attribute cache immediately', async () => {
      const attrs = vi.fn(async () => structuredClone(smartAttributesFixture));
      const startSelfTest = vi.fn(async () => {});
      const svc = new SmartService(createFakeSmartClient({ getAttributes: attrs, startSelfTest }), 60_000, 4_000);

      await svc.getAttributes(['sda']);
      await svc.startSelfTest('sda', 'short');
      await svc.getAttributes(['sda']);
      expect(attrs).toHaveBeenCalledTimes(2);
      expect(startSelfTest).toHaveBeenCalledWith('sda', 'short');
    });

    it('uses the shorter attribute TTL for attribute refreshes', async () => {
      const attrs = vi.fn(async () => structuredClone(smartAttributesFixture));
      const svc = new SmartService(createFakeSmartClient({ getAttributes: attrs }), 60_000, 4_000);

      await svc.getAttributes(['sda']); // cold
      vi.advanceTimersByTime(4_001); // past attr TTL, inside temp TTL
      await svc.getAttributes(['sda']);
      expect(attrs).toHaveBeenCalledTimes(2);
    });

    it('keeps attributes cached within the attribute TTL', async () => {
      const attrs = vi.fn(async () => structuredClone(smartAttributesFixture));
      const svc = new SmartService(createFakeSmartClient({ getAttributes: attrs }), 60_000, 4_000);

      await svc.getAttributes(['sda']);
      vi.advanceTimersByTime(3_999);
      await svc.getAttributes(['sda']);
      expect(attrs).toHaveBeenCalledTimes(1);
    });
  });
});
