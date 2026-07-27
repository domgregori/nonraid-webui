import { Router } from 'express';
import type { NmdClient } from '../nmd/index.js';
import type { SmartService } from '../smart/index.js';

export function smartRouter(nmd: NmdClient, smart: SmartService): Router {
  const router = Router();

  router.get('/smart/temperatures', async (_req, res) => {
    try {
      const status = await nmd.getStatus();
      const devices = status.disks.map((d) => d.device).filter((d) => d && d !== 'none');
      res.json(await smart.getTemperatures(devices));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
