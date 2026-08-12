import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import os from 'node:os';
import { Router } from 'express';
import multer from 'multer';
import type { ActivityStore } from '../activity/store.js';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import { NetRateTracker } from '../metrics/net.js';
import type { NmdClient } from '../nmd/client.js';
import { benchmarkRead, benchmarkWrite, resolveDurationMs } from '../system/benchmark.js';
import { resolveConfigBackupPaths, streamBootDiskImage, streamConfigBackup } from '../system/backupStream.js';
import type { BackupScheduler } from '../system/backupScheduler.js';
import {
  dropStagedRestore,
  getStagedRestore,
  isArrayBlank,
  listArchiveMembers,
  restoreArchiveMembers,
  stageRestoreFile,
  sweepStagedRestores,
} from '../system/configRestore.js';
import { listTimezones, setHostname, setTimezone } from '../system/hostConfig.js';
import type { SystemStatsService } from '../system/service.js';

// Config backups are small text files plus the 4KB superblock, but a long-lived activity log or
// many shares' worth of config could add up — generous but bounded, matching the same "don't
// silently truncate, reject clearly" intent as array.ts's own superblock upload limit.
const restoreUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 200 * 1024 * 1024 } });

export function systemRouter(system: SystemStatsService, nmd: NmdClient, activity: ActivityStore, backupScheduler: BackupScheduler): Router {
  const router = Router();

  router.get('/system', (_req, res) => {
    res.json(system.getStats());
  });

  // Own NetRateTracker instance, independent of the 60s history sampler's (see metrics/sampler.ts)
  // — the History page's Live mode polls this every 3s while open, so it needs its own delta
  // cadence rather than sharing/perturbing the sampler's. Stateless per request otherwise: no DB
  // writes, just a read of /proc/net/dev and a diff against the last call.
  const liveNetRate = new NetRateTracker();
  router.get('/system/net-live', async (_req, res) => {
    const rate = await liveNetRate.sample();
    res.json(rate ?? { rxKbS: null, txKbS: null });
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

  // Runs the exact same backup the schedule would, on demand, against the already-saved
  // destination directory in Settings -> Backups — save the destination there first. Distinct
  // from /system/boot-disk/backup/config above: that one streams a one-off download straight to
  // the browser and never touches the array; this one writes to the array like every scheduled
  // run, so it's covered by the same retention pruning.
  router.post('/system/backup/run-now', async (_req, res) => {
    try {
      const result = await backupScheduler.runNow();
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Uploads a config backup archive (same format streamConfigBackup/writeConfigBackupToFile
  // produce) and lists what's in it — nothing is extracted here, same "preview reads only, commit
  // acts" shape as /array/import/preview. Flags which member (if any) is the array superblock and
  // whether restoring it is currently allowed: only when the array has nothing assigned yet (see
  // configRestore.ts's isArrayBlank doc comment) — restoring an already-configured array's
  // superblock from a raw file, with no disk-matching preview the way ImportArrayWizard has, is a
  // different and much riskier operation than this endpoint is meant for.
  router.post('/system/backup/restore/preview', restoreUpload.single('file'), async (req, res) => {
    sweepStagedRestores();
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded.' });
      return;
    }
    try {
      const members = await listArchiveMembers(file.path, config.systemUseSudo);
      if (members.length === 0) throw new HttpError(400, 'Archive is empty or not a valid config backup.');

      const superblockPath = await nmd.getSuperblockPath();
      const superblockMember = superblockPath.replace(/^\//, '');
      const arrayIsBlank = await isArrayBlank(nmd);
      const status = await nmd.getStatus().catch(() => null);
      const arrayStopped = status ? status.array.state !== 'STARTED' : true;

      const token = randomUUID();
      stageRestoreFile(token, file.path);

      res.json({
        token,
        entries: members.map((m) => ({ path: `/${m}`, isSuperblock: m === superblockMember })),
        arrayIsBlank,
        arrayStopped,
      });
    } catch (err) {
      await unlink(file.path).catch(() => {});
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(502).json({ error: (err as Error).message });
      }
    }
  });

  // Re-validates everything fresh against live state rather than trusting the preview response —
  // same discipline as /array/import/commit — since time may have passed (the array could have
  // been started, or gained a disk) between preview and this call.
  router.post('/system/backup/restore/commit', async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const staged = token ? getStagedRestore(token) : undefined;
    if (!staged) {
      res.status(400).json({ error: 'This restore has expired or was already used — upload the file again.' });
      return;
    }
    try {
      const status = await nmd.getStatus().catch(() => null);
      if (status && status.array.state === 'STARTED') {
        throw new HttpError(400, 'Stop the array before restoring config.');
      }

      const members = await listArchiveMembers(staged.filePath, config.systemUseSudo);
      const superblockPath = await nmd.getSuperblockPath();
      const superblockMember = superblockPath.replace(/^\//, '');
      const arrayIsBlank = await isArrayBlank(nmd);

      const toRestore = members.filter((m) => m !== superblockMember || arrayIsBlank);
      const skippedSuperblock = members.includes(superblockMember) && !arrayIsBlank;
      // restoreArchiveMembers() itself drops bare directory members before extracting (see its own
      // doc comment) — mirrored here so the reported count matches what was actually written, not
      // what was merely requested.
      const restoredCount = toRestore.filter((m) => !m.endsWith('/')).length;

      await restoreArchiveMembers(staged.filePath, toRestore, config.systemUseSudo);
      dropStagedRestore(token);
      await unlink(staged.filePath).catch(() => {});

      const text = `Config restored (${restoredCount} item${restoredCount === 1 ? '' : 's'}${skippedSuperblock ? ', array superblock skipped — array already has disks assigned' : ''})`;
      activity.log(text, 'blue').catch(() => {});

      res.json({ restoredCount, skippedSuperblock });
    } catch (err) {
      const message = err instanceof HttpError ? err.message : (err as Error).message;
      activity.log(`Config restore failed: ${message}`, 'red').catch(() => {});
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(502).json({ error: message });
      }
    }
  });

  router.post('/system/boot-disk/benchmark/read', async (req, res) => {
    const device = system.getBootDiskDevice();
    if (!device) {
      res.status(404).json({ error: 'Boot disk could not be detected on this host.' });
      return;
    }
    const durationMs = resolveDurationMs(req.body?.durationSeconds);
    if (durationMs === null) {
      res.status(400).json({ error: 'durationSeconds must be a positive number.' });
      return;
    }
    try {
      const status = await nmd.getStatus();
      if (status.resync.active) {
        res.status(409).json({ error: 'A parity check or clear is in progress — refusing to benchmark mid-operation.' });
        return;
      }
      const result = await benchmarkRead(device, durationMs);
      activity.log(`Read benchmark on boot disk: ${result.mbPerSecond.toFixed(1)} MB/s`, 'blue').catch(() => {});
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/system/boot-disk/benchmark/write', async (req, res) => {
    const durationMs = resolveDurationMs(req.body?.durationSeconds);
    if (durationMs === null) {
      res.status(400).json({ error: 'durationSeconds must be a positive number.' });
      return;
    }
    try {
      const status = await nmd.getStatus();
      if (status.resync.active) {
        res.status(409).json({ error: 'A parity check or clear is in progress — refusing to benchmark mid-operation.' });
        return;
      }
      // The boot disk's mountpoint is always `/` — no lookup needed, unlike an array disk.
      const result = await benchmarkWrite('/', durationMs);
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
