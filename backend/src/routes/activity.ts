import { Router } from 'express';
import type { ActivityStore } from '../activity/index.js';

export function activityRouter(activity: ActivityStore): Router {
  const router = Router();

  router.get('/activity', async (req, res) => {
    try {
      const limit = Number(req.query.limit);
      res.json(await activity.list(Number.isInteger(limit) && limit > 0 ? limit : undefined));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
