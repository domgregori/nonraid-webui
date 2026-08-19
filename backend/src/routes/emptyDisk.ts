import { Router } from 'express';
import type { ActivityStore } from '../activity/index.js';
import type { EmptyDiskService } from '../emptyDisk/index.js';

function parseSlot(param: string): number | null {
  const slot = Number(param);
  return Number.isInteger(slot) && slot >= 1 && slot <= 28 ? slot : null;
}

export function emptyDiskRouter(emptyDisk: EmptyDiskService, activity: ActivityStore): Router {
  const router = Router();

  router.post('/disks/:slot/empty/plan', async (req, res) => {
    const slot = parseSlot(req.params.slot);
    if (slot === null) {
      res.status(400).json({ error: 'Slot must be a data disk (1-28).' });
      return;
    }
    try {
      const summary = await emptyDisk.plan(slot);
      res.json(summary);
    } catch (err) {
      const status = (err as { status?: number }).status ?? 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.post('/disks/:slot/empty/start', async (req, res) => {
    const slot = parseSlot(req.params.slot);
    if (slot === null) {
      res.status(400).json({ error: 'Slot must be a data disk (1-28).' });
      return;
    }
    try {
      await emptyDisk.start(slot);
      activity.log(`Emptying disk ${slot} started`, 'amber').catch(() => {});
      res.json({ ok: true, message: `Emptying slot ${slot} started.` });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.post('/disks/empty/cancel', (_req, res) => {
    emptyDisk.cancel();
    res.json({ ok: true, message: 'Cancelling - finishing the current file first.' });
  });

  router.get('/disks/empty/status', (_req, res) => {
    res.json(emptyDisk.status());
  });

  return router;
}
