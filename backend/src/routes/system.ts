import { stat } from 'node:fs/promises';
import { Router } from 'express';
import type { ActivityStore } from '../activity/store.js';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import type { NmdClient } from '../nmd/client.js';
import { streamBootDiskImage, streamConfigBackup } from '../system/backupStream.js';
import type { SystemStatsService } from '../system/service.js';

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

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
      const candidates = [
        config.smbConfPath,
        config.exportsPath,
        '/etc/nonraid',
        config.authConfigPath,
        config.sharesConfigPath,
        config.shareAccessConfigPath,
        config.settingsConfigPath,
        config.activityConfigPath,
        await nmd.getSuperblockPath(),
      ];
      const existing = (await Promise.all(candidates.map(async (p) => ((await pathExists(p)) ? p : null)))).filter(
        (p): p is string => p !== null,
      );
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
