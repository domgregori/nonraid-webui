import { Router } from 'express';
import type { NmdClient } from '../nmd/index.js';
import type { SettingsStore } from '../settings/index.js';

export function arrayRouter(nmd: NmdClient, settingsStore: SettingsStore): Router {
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
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/array/stop', async (_req, res) => {
    try {
      res.json(await nmd.stopArray());
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.put('/array/label', async (req, res) => {
    try {
      const label = typeof req.body?.label === 'string' ? req.body.label : '';
      res.json(await nmd.setLabel(label));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
