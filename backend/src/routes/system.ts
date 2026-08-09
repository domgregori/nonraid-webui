import { Router } from 'express';
import type { ActivityStore } from '../activity/store.js';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import type { NmdClient } from '../nmd/client.js';
import { benchmarkRead, benchmarkWrite } from '../system/benchmark.js';
import { resolveConfigBackupPaths, streamBootDiskImage, streamConfigBackup } from '../system/backupStream.js';
import { listTimezones, setHostname, setTimezone } from '../system/hostConfig.js';
import type { SystemStatsService } from '../system/service.js';

export function systemRouter(system: SystemStatsService, nmd: NmdClient, activity: ActivityStore): Router {
  const router = Router();

  router.get('/system', (_req, res) => {
    res.json(system.getStats());
  });

  router.get('/system/boot-disk/backup/image', (_req, res) => {
    const device = system.getBootDiskDevice();
    if (!device) {
      res.status(404).json({ error: 'Boot disk could not be detected on this host.' });
      return;
    }
    streamBootDiskImage(device, config.systemUseSudo, res, activity);
  });

  router.get('/system/boot-disk/backup/config', async (_req, res) => {
    try {
      const existing = await resolveConfigBackupPaths(nmd);
      if (existing.length === 0) {
        throw new HttpError(400, 'No NonRAID config files were found to back up.');
      }
      streamConfigBackup(existing, config.systemUseSudo, res, activity);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(502).json({ error: (err as Error).message });
      }
    }
  });

  router.post('/system/boot-disk/benchmark/read', async (_req, res) => {
    const device = system.getBootDiskDevice();
    if (!device) {
      res.status(404).json({ error: 'Boot disk could not be detected on this host.' });
      return;
    }
    try {
      const status = await nmd.getStatus();
      if (status.resync.active) {
        res.status(409).json({ error: 'A parity check or clear is in progress — refusing to benchmark mid-operation.' });
        return;
      }
      const result = await benchmarkRead(device);
      activity.log(`Read benchmark on boot disk: ${result.mbPerSecond.toFixed(1)} MB/s`, 'blue').catch(() => {});
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/system/boot-disk/benchmark/write', async (_req, res) => {
    try {
      const status = await nmd.getStatus();
      if (status.resync.active) {
        res.status(409).json({ error: 'A parity check or clear is in progress — refusing to benchmark mid-operation.' });
        return;
      }
      // The boot disk's mountpoint is always `/` — no lookup needed, unlike an array disk.
      const result = await benchmarkWrite('/');
      activity.log(`Write benchmark on boot disk: ${result.mbPerSecond.toFixed(1)} MB/s`, 'blue').catch(() => {});
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.get('/system/timezones', async (_req, res) => {
    try {
      res.json(await listTimezones());
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.put('/system/hostname', async (req, res) => {
    const name = typeof req.body?.hostname === 'string' ? req.body.hostname.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'hostname is required.' });
      return;
    }
    try {
      await setHostname(name, config.systemUseSudo);
      activity.log(`Hostname changed to "${name}"`, 'blue').catch(() => {});
      res.json({ ok: true, message: `Hostname set to "${name}". Some services may need a restart to fully pick it up.` });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.put('/system/timezone', async (req, res) => {
    const tz = typeof req.body?.timezone === 'string' ? req.body.timezone.trim() : '';
    if (!tz) {
      res.status(400).json({ error: 'timezone is required.' });
      return;
    }
    try {
      await setTimezone(tz, config.systemUseSudo);
      activity.log(`Timezone changed to "${tz}"`, 'blue').catch(() => {});
      res.json({ ok: true, message: `Timezone set to "${tz}".` });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
