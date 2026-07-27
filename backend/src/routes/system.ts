import { Router } from 'express';
import type { SystemStatsService } from '../system/service.js';

export function systemRouter(system: SystemStatsService): Router {
  const router = Router();

  router.get('/system', (_req, res) => {
    res.json(system.getStats());
  });

  return router;
}
