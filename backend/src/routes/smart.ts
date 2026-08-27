import { Router } from 'express';
import type { NmdClient } from '../nmd/index.js';
import type { SmartService } from '../smart/index.js';
import { getDiskType } from '../system/diskType.js';
import type { SystemStatsService } from '../system/service.js';

export function smartRouter(nmd: NmdClient, smart: SmartService, system: SystemStatsService): Router {
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

  router.get('/smart/spin-states', async (_req, res) => {
    try {
      const status = await nmd.getStatus();
      const devices = status.disks.map((d) => d.device).filter((d) => d && d !== 'none');
      res.json(await smart.getSpinStates(devices));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.get('/smart/health', async (_req, res) => {
    try {
      const status = await nmd.getStatus();
      const devices = status.disks.map((d) => d.device).filter((d) => d && d !== 'none');
      res.json(await smart.getHealthStatuses(devices));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // isSSD never changes at runtime for a given device, so this is a plain per-request lsblk call
  // (fast, no caching needed) rather than SmartService's stale-while-revalidate machinery, which
  // exists specifically because smartctl reads are slow - lsblk isn't.
  router.get('/smart/disk-types', async (_req, res) => {
    try {
      const status = await nmd.getStatus();
      const devices = status.disks.map((d) => d.device).filter((d) => d && d !== 'none');
      const entries = await Promise.all(devices.map(async (d) => [d, await getDiskType(d)] as const));
      res.json(Object.fromEntries(entries));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // Device-path-based SMART lookup, for disks with no array slot to key off (unassigned devices,
  // the boot disk). Never trusts a raw client-supplied path without validating it's a real,
  // currently-relevant device first - same discipline routes/disks.ts's add/replace handlers use.
  router.get('/smart/by-device', async (req, res) => {
    const device = req.query.device;
    if (typeof device !== 'string' || !device) {
      res.status(400).json({ error: 'device is required.' });
      return;
    }
    try {
      const bootDevice = system.getBootDiskDevice();
      const isBootDisk = bootDevice !== null && device === bootDevice;
      if (!isBootDisk) {
        const available = await nmd.listAvailableDevices();
        if (!available.some((d) => d.device === device)) {
          res.status(400).json({ error: `${device} is not a currently available or boot device.` });
          return;
        }
      }
      const result = await smart.getAttributes([device]);
      res.json(result[device] ?? null);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
