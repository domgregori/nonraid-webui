import { Router } from 'express';
import type { DiskQueueService } from '../diskQueue/service.js';
import { HttpError } from '../httpError.js';
import type { NmdClient } from '../nmd/index.js';

// nmdctl's own slot numbering (see backend/src/nmd/superblock.ts's MD_SB_P_IDX/MD_SB_Q_IDX):
// slot 0 is always Parity 1, slot 29 is always Parity 2, 1-28 are data. Mirrors
// AddDiskDialog.tsx's existing client-side logic, now computed server-side instead.
const PARITY_SLOT = 0;
const PARITY2_SLOT = 29;

export function diskQueueRouter(diskQueue: DiskQueueService, nmd: NmdClient): Router {
  const router = Router();

  router.get('/disk-queue/status', (_req, res) => {
    res.json(diskQueue.list());
  });

  router.post('/disk-queue/parity', async (req, res) => {
    const device = req.body?.device;
    if (typeof device !== 'string' || !device) {
      res.status(400).json({ error: 'device is required.' });
      return;
    }
    try {
      // Same fresh-scan validation the old direct /disks/:slot/add route used - purely for
      // immediate UI feedback here; runItem() re-validates again for real once this item's turn
      // actually comes up (see DiskQueueService's doc comment on why enqueue-time validation
      // isn't a substitute for that).
      const [available, status] = await Promise.all([nmd.listAvailableDevices(), nmd.getStatus()]);
      const match = available.find((d) => d.device === device);
      if (!match) {
        res.status(400).json({ error: `${device} is not a currently available device.` });
        return;
      }
      const usedSlots = new Set(status.disks.filter((d) => d.disk_id).map((d) => d.slot));
      const slot = !usedSlots.has(PARITY_SLOT) ? PARITY_SLOT : !usedSlots.has(PARITY2_SLOT) ? PARITY2_SLOT : null;
      if (slot === null) {
        res.status(409).json({ error: 'Both parity slots are already assigned.' });
        return;
      }
      const item = diskQueue.enqueueAddDisk('add-parity', slot, device, match.model ?? device);
      res.json(item);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.post('/disk-queue/data', async (req, res) => {
    const device = req.body?.device;
    if (typeof device !== 'string' || !device) {
      res.status(400).json({ error: 'device is required.' });
      return;
    }
    try {
      const [available, status] = await Promise.all([nmd.listAvailableDevices(), nmd.getStatus()]);
      const match = available.find((d) => d.device === device);
      if (!match) {
        res.status(400).json({ error: `${device} is not a currently available device.` });
        return;
      }
      const usedSlots = new Set(status.disks.filter((d) => d.disk_id).map((d) => d.slot));
      const slot = Array.from({ length: 28 }, (_, i) => i + 1).find((s) => !usedSlots.has(s));
      if (slot === undefined) {
        res.status(409).json({ error: 'No free data slot (1-28) available.' });
        return;
      }
      const item = diskQueue.enqueueAddDisk('add-data', slot, device, match.model ?? device);
      res.json(item);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.post('/disk-queue/cache-mirror', async (req, res) => {
    const deviceA = req.body?.deviceA;
    const deviceB = req.body?.deviceB;
    if (typeof deviceA !== 'string' || !deviceA || typeof deviceB !== 'string' || !deviceB) {
      res.status(400).json({ error: 'deviceA and deviceB are required.' });
      return;
    }
    if (deviceA === deviceB) {
      res.status(400).json({ error: 'Pick two different devices for the mirror.' });
      return;
    }
    try {
      const available = await nmd.listAvailableDevices();
      const matchA = available.find((d) => d.device === deviceA);
      const matchB = available.find((d) => d.device === deviceB);
      if (!matchA) {
        res.status(400).json({ error: `${deviceA} is not a currently available device.` });
        return;
      }
      if (!matchB) {
        res.status(400).json({ error: `${deviceB} is not a currently available device.` });
        return;
      }
      const label = `${matchA.model ?? deviceA} + ${matchB.model ?? deviceB}`;
      const item = diskQueue.enqueueCacheMirror(deviceA, deviceB, label);
      res.json(item);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.post('/disk-queue/:id/retry', (req, res) => {
    try {
      diskQueue.retry(req.params.id!);
      const item = diskQueue.list().items.find((i) => i.id === req.params.id);
      res.json(item ?? null);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.delete('/disk-queue/:id', (req, res) => {
    try {
      diskQueue.remove(req.params.id!);
      res.json({ ok: true });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.post('/disk-queue/clear', (_req, res) => {
    diskQueue.clear();
    res.json({ ok: true });
  });

  return router;
}
