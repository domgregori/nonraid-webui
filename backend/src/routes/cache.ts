import { Router } from 'express';
import type { ActivityStore } from '../activity/index.js';
import type { CacheMoverService } from '../cache/mover.js';
import type { CacheService } from '../cache/service.js';
import { HttpError } from '../httpError.js';
import type { SettingsStore } from '../settings/store.js';
import type { ShareService } from '../shares/index.js';

export function cacheRouter(
  cache: CacheService,
  mover: CacheMoverService,
  settingsStore: SettingsStore,
  activity: ActivityStore,
  shares: ShareService,
): Router {
  const router = Router();

  router.get('/cache/status', async (_req, res) => {
    try {
      res.json(await cache.getStatus());
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/cache/setup', async (req, res) => {
    const deviceA = req.body?.deviceA;
    const deviceB = req.body?.deviceB;
    if (typeof deviceA !== 'string' || !deviceA || typeof deviceB !== 'string' || !deviceB) {
      res.status(400).json({ error: 'deviceA and deviceB are required.' });
      return;
    }
    try {
      await cache.setup(deviceA, deviceB);
      await shares.remountAll();
      const text = `Cache pool set up (${deviceA} + ${deviceB}, mirrored)`;
      activity.log(text, 'green').catch(() => {});
      res.json({ ok: true, message: text });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.post('/cache/replace', async (req, res) => {
    const device = req.body?.device;
    if (typeof device !== 'string' || !device) {
      res.status(400).json({ error: 'device is required.' });
      return;
    }
    try {
      await cache.replaceDevice(device);
      activity.log(`Cache mirror replacement started with ${device}`, 'amber').catch(() => {});
      res.json({ ok: true, message: `Replacement started with ${device}.` });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.get('/cache/replace/status', async (_req, res) => {
    try {
      res.json(await cache.replaceStatus());
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.put('/cache/enabled', async (req, res) => {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean.' });
      return;
    }
    try {
      const current = await settingsStore.get();
      if (enabled && !current.cache.fsUuid) {
        res.status(409).json({ error: 'Set up the cache mirror before enabling it.' });
        return;
      }
      await settingsStore.update({ cache: { enabled } });
      await shares.remountAll();
      activity.log(`Cache pool ${enabled ? 'enabled' : 'disabled'} for shares`, 'blue').catch(() => {});
      res.json({ ok: true, message: `Cache pool ${enabled ? 'enabled' : 'disabled'}.` });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/cache/mover/run', async (_req, res) => {
    try {
      await mover.run();
      activity.log('Cache mover started', 'blue').catch(() => {});
      res.json({ ok: true, message: 'Cache mover started.' });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.get('/cache/mover/status', (_req, res) => {
    res.json(mover.status());
  });

  router.post('/cache/mover/cancel', (_req, res) => {
    mover.cancel();
    res.json({ ok: true, message: 'Cancelling cache mover.' });
  });

  return router;
}
