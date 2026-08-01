import { Router } from 'express';
import type { ActivityStore } from '../activity/index.js';
import type { NmdClient } from '../nmd/index.js';
import { sendAppriseNotification, type SettingsStore } from '../settings/index.js';

export function settingsRouter(store: SettingsStore, nmd: NmdClient, activity: ActivityStore): Router {
  const router = Router();

  router.get('/settings', async (_req, res) => {
    try {
      res.json(await store.get());
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // Applies turboWrite live before persisting it, so a failed apply (e.g. the
  // array isn't started, or the driver module isn't loaded) doesn't silently
  // save a setting nothing actually honored — the whole request fails
  // together rather than partially succeeding.
  router.put('/settings', async (req, res) => {
    try {
      const patch = req.body ?? {};
      if (typeof patch.turboWrite === 'boolean') {
        await nmd.setWriteMethod(patch.turboWrite);
        activity.log(patch.turboWrite ? 'Turbo write enabled' : 'Turbo write disabled', 'blue').catch(() => {});
      }
      res.json(await store.update(patch));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/settings/notifications/test', async (_req, res) => {
    try {
      const settings = await store.get();
      res.json(await sendAppriseNotification(settings.notifications.appriseUrls, 'NonRAID', 'Test notification from the nonraid dashboard.'));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
