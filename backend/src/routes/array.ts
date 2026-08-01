import { Router } from 'express';
import type { ActivityStore } from '../activity/index.js';
import type { NmdClient } from '../nmd/index.js';
import type { SettingsStore } from '../settings/index.js';

export function arrayRouter(nmd: NmdClient, settingsStore: SettingsStore, activity: ActivityStore): Router {
  const router = Router();

  router.post('/array/start', async (_req, res) => {
    try {
      const result = await nmd.startArray();
      // The driver forgets write method across a stop/start (no persistence
      // of its own — see nmd/client.ts's setWriteMethod doc comment), so
      // reapply our persisted preference every time, the same way real
      // Unraid's webGUI resends its tunable as part of its own array-start
      // sequence. Best-effort: a failure here shouldn't fail array start.
      const settings = await settingsStore.get();
      if (settings.turboWrite) await nmd.setWriteMethod(true).catch(() => {});
      activity.log('Array started', 'green').catch(() => {});
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/array/stop', async (_req, res) => {
    try {
      const result = await nmd.stopArray();
      activity.log('Array stopped', 'blue').catch(() => {});
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.put('/array/label', async (req, res) => {
    try {
      const label = typeof req.body?.label === 'string' ? req.body.label : '';
      const result = await nmd.setLabel(label);
      activity.log(label ? `Array label changed to "${label}"` : 'Array label cleared', 'blue').catch(() => {});
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
