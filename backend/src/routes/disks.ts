import { Router } from 'express';
import type { ActivityStore } from '../activity/index.js';
import type { NmdClient } from '../nmd/index.js';
import { notifyEvent } from '../settings/notify.js';
import type { SettingsStore } from '../settings/store.js';
import type { SelfTestType, SmartService } from '../smart/index.js';
import { spinDown, spinUp } from '../system/hdparm.js';

const SELF_TEST_TYPES: SelfTestType[] = ['short', 'long', 'conveyance'];

function parseSlot(param: string): number | null {
  const slot = Number(param);
  return Number.isInteger(slot) && slot >= 0 && slot <= 29 ? slot : null;
}

export function disksRouter(nmd: NmdClient, smart: SmartService, activity: ActivityStore, settingsStore: SettingsStore): Router {
  const router = Router();

  router.get('/disks/available', async (_req, res) => {
    try {
      const devices = await nmd.listAvailableDevices();
      res.json(devices);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/disks/:slot/add', async (req, res) => {
    const slot = parseSlot(req.params.slot);
    if (slot === null) {
      res.status(400).json({ error: 'Slot must be a number 0-29.' });
      return;
    }
    const device = req.body?.device;
    if (typeof device !== 'string' || !device) {
      res.status(400).json({ error: 'device is required.' });
      return;
    }
    try {
      // Validate against a fresh scan rather than trusting a raw client-supplied
      // path — this shells out with `device`, so it must be a real, currently
      // available device, not attacker-controlled input.
      const available = await nmd.listAvailableDevices();
      const match = available.find((d) => d.device === device);
      if (!match) {
        res.status(400).json({ error: `${device} is not a currently available device.` });
        return;
      }
      // Use the specific free partition when the scan found one — never the
      // whole parent device in that case. Only fall back to the whole
      // device when the disk genuinely has no partitions at all (a blank
      // disk with nothing else on it). Passing the whole device for a disk
      // that has *other* partitions (even unmounted ones don't imply the
      // rest of the disk is safe — see the mounted-sibling check this is
      // paired with in NmdClient.addDisk itself) is exactly the bug that
      // zeroed this project's own test VM's root filesystem once already.
      const target = match.partition ?? match.device;
      const result = await nmd.addDisk(slot, target, match.diskId ?? undefined);
      const text = `Disk ${device} added to slot ${slot}`;
      activity.log(text, 'blue').catch(() => {});
      notifyEvent(settingsStore, 'diskAdded', 'NonRAID: disk added', text);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/disks/:slot/replace', async (req, res) => {
    const slot = parseSlot(req.params.slot);
    if (slot === null) {
      res.status(400).json({ error: 'Slot must be a number 0-29.' });
      return;
    }
    const device = req.body?.device;
    if (typeof device !== 'string' || !device) {
      res.status(400).json({ error: 'device is required.' });
      return;
    }
    try {
      // Same fresh-scan validation addDisk uses — see the comment there for why.
      const available = await nmd.listAvailableDevices();
      const match = available.find((d) => d.device === device);
      if (!match) {
        res.status(400).json({ error: `${device} is not a currently available device.` });
        return;
      }
      const target = match.partition ?? match.device;
      const result = await nmd.replaceDisk(slot, target, match.diskId ?? undefined);
      const text = `Disk in slot ${slot} replaced with ${device}`;
      activity.log(text, 'amber').catch(() => {});
      notifyEvent(settingsStore, 'diskAdded', 'NonRAID: disk replaced', text);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/disks/:slot/restore', async (req, res) => {
    const slot = parseSlot(req.params.slot);
    if (slot === null) {
      res.status(400).json({ error: 'Slot must be a number 0-29.' });
      return;
    }
    try {
      const result = await nmd.restoreUnassignedDisk(slot);
      activity.log(`Disk in slot ${slot} restored after unassign`, 'blue').catch(() => {});
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/disks/:slot/format', async (req, res) => {
    const slot = parseSlot(req.params.slot);
    if (slot === null) {
      res.status(400).json({ error: 'Slot must be a number 0-29.' });
      return;
    }
    try {
      const result = await nmd.formatDisk(slot);
      activity.log(`Disk in slot ${slot} formatted (XFS)`, 'blue').catch(() => {});
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/disks/:slot/mount', async (req, res) => {
    const slot = parseSlot(req.params.slot);
    if (slot === null) {
      res.status(400).json({ error: 'Slot must be a number 0-29.' });
      return;
    }
    try {
      // nmdctl has no per-slot mount subcommand — this mounts every currently-unmounted disk in
      // one pass (confirmed live: skips disks with no filesystem rather than erroring), then
      // reports specifically whether the requested slot ended up mounted.
      await nmd.mountDisks();
      const status = await nmd.getStatus();
      const disk = status.disks.find((d) => d.slot === slot);
      const mountpoint = disk?.filesystem?.mountpoint;
      if (!mountpoint || mountpoint === 'unmounted') {
        res
          .status(502)
          .json({ error: `Disk ${slot} is still unmounted — it may have no filesystem yet, or nmdctl couldn't mount it.` });
        return;
      }
      activity.log(`Disk ${slot} mounted at ${mountpoint}`, 'blue').catch(() => {});
      res.json({ ok: true, message: `Disk ${slot} mounted at ${mountpoint}` });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

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

  router.post('/disks/:slot/spin-down', async (req, res) => {
    const slot = parseSlot(req.params.slot);
    if (slot === null) {
      res.status(400).json({ error: 'Slot must be a number 0-29.' });
      return;
    }
    try {
      const status = await nmd.getStatus();
      if (status.resync.active) {
        res.status(409).json({ error: 'A parity check or clear is in progress — refusing to spin down a disk mid-operation.' });
        return;
      }
      const disk = status.disks.find((d) => d.slot === slot);
      if (!disk || !disk.device || disk.device === 'none') {
        res.status(404).json({ error: `No disk assigned to slot ${slot}.` });
        return;
      }
      await spinDown(disk.device);
      activity.log(`Disk ${slot} (${disk.disk_name || disk.device}) spun down`, 'blue').catch(() => {});
      res.json({ ok: true, message: `Disk ${slot} spun down.` });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/disks/:slot/spin-up', async (req, res) => {
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
      await spinUp(disk.device);
      activity.log(`Disk ${slot} (${disk.disk_name || disk.device}) spun up`, 'blue').catch(() => {});
      res.json({ ok: true, message: `Disk ${slot} spun up.` });
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
