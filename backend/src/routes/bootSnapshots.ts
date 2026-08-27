import { Router } from 'express';
import type { ActivityStore } from '../activity/index.js';
import { HttpError } from '../httpError.js';
import { createBootSnapshot, deleteBootSnapshot, isBtrfsRoot, listBootSnapshots } from '../system/bootSnapshots.js';

export function bootSnapshotsRouter(activity: ActivityStore): Router {
  const router = Router();

  router.get('/system/boot-snapshots', async (_req, res) => {
    try {
      const [btrfsRoot, snapshots] = await Promise.all([isBtrfsRoot(), listBootSnapshots()]);
      res.json({ btrfsRoot, snapshots });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/system/boot-snapshots', async (req, res) => {
    try {
      const label = typeof req.body?.label === 'string' ? req.body.label : undefined;
      const snapshot = await createBootSnapshot(label);
      activity.log(`Boot snapshot "${snapshot.name}" created`, 'blue').catch(() => {});
      res.json(snapshot);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.delete('/system/boot-snapshots/:name', async (req, res) => {
    try {
      await deleteBootSnapshot(req.params.name);
      activity.log(`Boot snapshot "${req.params.name}" deleted`, 'blue').catch(() => {});
      res.json({ ok: true, message: `Boot snapshot "${req.params.name}" deleted` });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  return router;
}
