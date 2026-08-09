import { Router } from 'express';
import type { ActivityStore } from '../activity/store.js';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import type { NmdClient } from '../nmd/client.js';
import { resolveConfigBackupPaths, streamBootDiskImage, streamConfigBackup } from '../system/backupStream.js';
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

  return router;
}
