import { Router } from 'express';
import type { NmdClient } from '../nmd/index.js';

export function arrayRouter(nmd: NmdClient): Router {
  const router = Router();

  router.post('/array/start', async (_req, res) => {
    try {
      res.json(await nmd.startArray());
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

  return router;
}
