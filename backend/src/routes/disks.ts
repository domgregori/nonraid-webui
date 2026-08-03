import { Router } from 'express';
import type { ActivityStore } from '../activity/index.js';
import type { NmdClient } from '../nmd/index.js';
import type { SelfTestType, SmartService } from '../smart/index.js';

const SELF_TEST_TYPES: SelfTestType[] = ['short', 'long', 'conveyance'];

function parseSlot(param: string): number | null {
  const slot = Number(param);
  return Number.isInteger(slot) && slot >= 0 && slot <= 29 ? slot : null;
}

export function disksRouter(nmd: NmdClient, smart: SmartService, activity: ActivityStore): Router {
  const router = Router();

  router.post('/disks/:slot/unassign', async (req, res) => {
    const slot = parseSlot(req.params.slot);
    if (slot === null) {
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

  router.get('/disks/:slot/smart', async (req, res) => {
    const slot = parseSlot(req.params.slot);
    if (slot === null) {
      res.status(400).json({ error: 'Slot must be a number 0-29.' });
      return;
    }
    try {
      const status = await nmd.getStatus();
      const disk = status.disks.find((d) => d.slot === slot);
      if (!disk || !disk.device || disk.device === 'none') {
        res.status(404).json({ error: `No disk assigned to slot ${slot}.` });
        return;
      }
      const result = await smart.getAttributes([disk.device]);
      res.json(result[disk.device] ?? null);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/disks/:slot/smart/self-test', async (req, res) => {
    const slot = parseSlot(req.params.slot);
    if (slot === null) {
      res.status(400).json({ error: 'Slot must be a number 0-29.' });
      return;
    }
    const type = req.body?.type;
    if (!SELF_TEST_TYPES.includes(type)) {
      res.status(400).json({ error: `type must be one of: ${SELF_TEST_TYPES.join(', ')}` });
      return;
    }
    try {
      // Device comes from the real disk list for this slot, never straight from the request body —
      // this shells out to smartctl with it, so it must not be attacker-controlled input.
      const status = await nmd.getStatus();
      const disk = status.disks.find((d) => d.slot === slot);
      if (!disk || !disk.device || disk.device === 'none') {
        res.status(404).json({ error: `No disk assigned to slot ${slot}.` });
        return;
      }
      await smart.startSelfTest(disk.device, type);
      activity.log(`SMART ${type} self-test started on disk ${slot} (${disk.disk_name || disk.device})`, 'blue').catch(() => {});
      res.json({ ok: true, message: `${type} self-test started` });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
