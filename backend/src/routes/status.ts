import { Router } from 'express';
import type { NmdClient } from '../nmd/index.js';

export function statusRouter(nmd: NmdClient): Router {
  const router = Router();

  router.get('/status', async (_req, res) => {
    try {
      res.json(await nmd.getStatus());
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
