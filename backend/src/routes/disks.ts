import { Router } from 'express';
import type { ActivityStore } from '../activity/index.js';
import type { NmdClient } from '../nmd/index.js';

export function disksRouter(nmd: NmdClient, activity: ActivityStore): Router {
  const router = Router();

  router.post('/disks/:slot/unassign', async (req, res) => {
    const slot = Number(req.params.slot);
    if (!Number.isInteger(slot) || slot < 0 || slot > 29) {
      res.status(400).json({ error: 'Slot must be a number 0-29.' });
      return;
    }
    try {
      const result = await nmd.unassignDisk(slot);
      activity.log(`Disk unassigned from slot ${slot}`, 'amber').catch(() => {});
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
