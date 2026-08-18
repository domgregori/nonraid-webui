import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import os from 'node:os';
import { Router } from 'express';
import multer from 'multer';
import type { ActivityStore } from '../activity/store.js';
import { config } from '../config.js';
import { DAEMON_JSON_PATH, getConfiguredDockerStorage } from '../docker/storagePath.js';
import { HttpError } from '../httpError.js';
import { NetRateTracker } from '../metrics/net.js';
import type { NmdClient } from '../nmd/client.js';
import type { MetricsService } from '../metrics/service.js';
import { benchmarkRead, benchmarkWrite, resolveDurationMs } from '../system/benchmark.js';
import { resolveConfigBackupPaths, streamBootDiskImage, streamConfigBackup } from '../system/backupStream.js';
import type { BackupScheduler } from '../system/backupScheduler.js';
import { categoryForMember, resolveBackupCategories, type BackupCategoryId } from '../system/backupCatalog.js';
import {
  dropStagedRestore,
  getStagedRestore,
  isArrayBlank,
  listArchiveMembers,
  restoreArchiveMembers,
  stageRestoreFile,
  sweepStagedRestores,
} from '../system/configRestore.js';
import { listTimezones, rebootHost, setHostname, setTimezone } from '../system/hostConfig.js';
import type { SystemStatsService } from '../system/service.js';
import { restartService, SERVICE_DEFS } from '../system/services.js';

// Config backups are small text files plus the 4KB superblock, but a long-lived activity log or
// many shares' worth of config could add up - generous but bounded, matching the same "don't
// silently truncate, reject clearly" intent as array.ts's own superblock upload limit.
const restoreUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 200 * 1024 * 1024 } });

export function systemRouter(
  system: SystemStatsService,
  nmd: NmdClient,
  activity: ActivityStore,
  backupScheduler: BackupScheduler,
  metrics: MetricsService,
): Router {
  const router = Router();

  router.get('/system', (_req, res) => {
    res.json(system.getStats());
  });

  // Own NetRateTracker instance, independent of the 60s history sampler's (see metrics/sampler.ts)
  // - the History page's Live mode polls this every 3s while open, so it needs its own delta
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
    streamBootDiskImage(device, res, activity);
  });

  router.get('/system/boot-disk/backup/config', async (_req, res) => {
    try {
      metrics.checkpointForBackup();
      const existing = await resolveConfigBackupPaths(nmd);
      if (existing.length === 0) {
        throw new HttpError(400, 'No NonRAID config files were found to back up.');
      }
      streamConfigBackup(existing, res, activity);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(502).json({ error: (err as Error).message });
      }
    }
  });

  // Runs the exact same backup the schedule would, on demand, against the already-saved
  // destination directory in Settings -> Backups - save the destination there first. Distinct
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
  // produce) and lists what's in it - nothing is extracted here, same "preview reads only, commit
  // acts" shape as /array/import/preview. Flags which member (if any) is the array superblock and
  // whether restoring it is currently allowed: only when the array has nothing assigned yet (see
  // configRestore.ts's isArrayBlank doc comment) - restoring an already-configured array's
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
      const members = await listArchiveMembers(file.path);
      if (members.length === 0) throw new HttpError(400, 'Archive is empty or not a valid config backup.');

      const superblockPath = await nmd.getSuperblockPath();
      const superblockMember = superblockPath.replace(/^\//, '');
      const arrayIsBlank = await isArrayBlank(nmd);
      const status = await nmd.getStatus().catch(() => null);
      const arrayStopped = status ? status.array.state !== 'STARTED' : true;

      const categories = await resolveBackupCategories(nmd);
      // Directory members (e.g. "etc/nonraid/") are counted in their category's totals below but
      // dropped from the flat `entries` shown per-member - same reasoning restoreArchiveMembers()
      // itself already has for not extracting them: a bare directory carries nothing the file
      // members inside it don't already imply.
      const categoryPreviews = categories
        .map((cat) => ({
          id: cat.id,
          label: cat.label,
          description: cat.description,
          entries: members.filter((m) => !m.endsWith('/') && categoryForMember(m, categories) === cat.id).map((m) => `/${m}`),
        }))
        .filter((c) => c.entries.length > 0);

      const token = randomUUID();
      stageRestoreFile(token, file.path);

      res.json({
        token,
        entries: members.map((m) => ({ path: `/${m}`, isSuperblock: m === superblockMember })),
        categories: categoryPreviews,
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

  // Re-validates everything fresh against live state rather than trusting the preview response -
  // same discipline as /array/import/commit - since time may have passed (the array could have
  // been started, or gained a disk) between preview and this call.
  router.post('/system/backup/restore/commit', async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const staged = token ? getStagedRestore(token) : undefined;
    if (!staged) {
      res.status(400).json({ error: 'This restore has expired or was already used - upload the file again.' });
      return;
    }
    try {
      const status = await nmd.getStatus().catch(() => null);
      if (status && status.array.state === 'STARTED') {
        throw new HttpError(400, 'Stop the array before restoring config.');
      }

      const members = await listArchiveMembers(staged.filePath);
      const superblockPath = await nmd.getSuperblockPath();
      const superblockMember = superblockPath.replace(/^\//, '');
      const arrayIsBlank = await isArrayBlank(nmd);
      const categories = await resolveBackupCategories(nmd);

      // Missing/malformed `categories` means "everything" (the field didn't exist before this
      // selection feature - old clients, or a plain re-POST of a preview response, still restore
      // the full archive rather than silently restoring nothing).
      const requestedCategories = Array.isArray(req.body?.categories) ? (req.body.categories as unknown[]) : null;
      const selected: Set<BackupCategoryId> = requestedCategories
        ? new Set(requestedCategories.filter((c): c is BackupCategoryId => categories.some((cat) => cat.id === c)))
        : new Set(categories.map((c) => c.id));

      const toRestore = members.filter((m) => {
        if (m === superblockMember && !arrayIsBlank) return false; // the existing safety gate, independent of selection
        const cat = categoryForMember(m, categories);
        return cat !== null && selected.has(cat);
      });
      const skippedSuperblock = members.includes(superblockMember) && !arrayIsBlank;
      // restoreArchiveMembers() itself drops bare directory members before extracting (see its own
      // doc comment) - mirrored here so the reported count matches what was actually written, not
      // what was merely requested.
      const restoredCount = toRestore.filter((m) => !m.endsWith('/')).length;

      await restoreArchiveMembers(staged.filePath, toRestore);
      dropStagedRestore(token);
      await unlink(staged.filePath).catch(() => {});

      // The archived metrics.db is a complete, checkpointed snapshot on its own (see
      // MetricsService.checkpointForBackup) - but the *current* database this just overwrote may
      // still have its own -wal/-shm sidecars sitting next to it from live activity since the last
      // checkpoint. Left in place, SQLite would try to replay that leftover WAL against the freshly
      // restored (unrelated) .db file the next time it's opened, misapplying old transactions onto
      // data from a different point in time entirely. Only the restored .db file itself should be
      // trusted going forward - nonraid-webui's own restart (part of Restart Services) is what
      // actually reopens the connection and needs these gone before that happens.
      const graphHistoryMember = config.metricsDbPath.replace(/^\//, '');
      if (toRestore.includes(graphHistoryMember)) {
        await unlink(`${config.metricsDbPath}-wal`).catch(() => {});
        await unlink(`${config.metricsDbPath}-shm`).catch(() => {});
      }

      // Docker only reads daemon.json at startup - a restored data-root relocation is inert until
      // the daemon restarts, and restarting Docker stops every running container, so this is only
      // ever done when the archive actually had this member (see restart-services below, which
      // takes this as an explicit opt-in rather than restarting Docker on every restore).
      const dockerConfigMember = DAEMON_JSON_PATH.replace(/^\//, '');
      const dockerConfigRestored = toRestore.includes(dockerConfigMember);

      // restoreArchiveMembers() only writes the file - the already-running kernel module has no
      // way to know its superblock file changed underneath it (confirmed live: the array stayed
      // reporting blank, and the onboarding wizard kept bouncing back to its very first screen,
      // no matter how many times status was re-fetched, since that was genuinely accurate live
      // driver state, not stale frontend data). Only needed when the superblock was actually
      // restored (skippedSuperblock covers "wasn't in the archive" and "already had disks" both);
      // a reload failure doesn't undo the file restore, so it's reported alongside success rather
      // than turned into a 502 - the files are safely on disk either way, only the running
      // module's own state needs a retry (or a reboot) to catch up.
      const superblockRestored = toRestore.includes(superblockMember);
      let superblockReloadError: string | null = null;
      if (superblockRestored) {
        try {
          await nmd.reloadModuleAndImport();
        } catch (err) {
          superblockReloadError = (err as Error).message;
        }
      }

      const text = `Config restored (${restoredCount} item${restoredCount === 1 ? '' : 's'}${skippedSuperblock ? ', array superblock skipped - array already has disks assigned' : ''})`;
      activity.log(text, 'blue').catch(() => {});
      if (superblockReloadError) {
        activity.log(`Config restore's superblock reload failed: ${superblockReloadError}`, 'red').catch(() => {});
      }

      res.json({ restoredCount, skippedSuperblock, superblockReloadError, dockerConfigRestored });
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

  // Manual retry for the reload restoreArchiveMembers's superblock member above already attempts
  // automatically - same operation, exposed on its own so a failed auto-reload (or any other case
  // where the superblock file on disk changed without the running module knowing, e.g. this route
  // itself only ever half-succeeding earlier) can be retried without redoing the whole restore.
  router.post('/system/reload-driver', async (_req, res) => {
    try {
      const result = await nmd.reloadModuleAndImport();
      activity.log(`Driver reloaded, ${result.importedCount} disk(s) re-imported`, 'blue').catch(() => {});
      res.json({ result });
    } catch (err) {
      const message = (err as Error).message;
      activity.log(`Driver reload failed: ${message}`, 'red').catch(() => {});
      res.status(502).json({ error: message });
    }
  });

  // The config-restore result screen's single "make everything take effect" action - SMB, NFS,
  // driver reload, and nonraid-webui itself, instead of four separate buttons for what's really
  // one "apply what was just restored" step. Order matters: SMB/NFS/driver run first so their own
  // outcomes can still be reported in this response; the webui restart runs last (self-exit, same
  // pattern as /services/webui/restart) since it drops this connection. Each step is independent
  // and best-effort - one failing doesn't skip the rest, since e.g. a driver reload failure
  // shouldn't leave Samba serving a stale smb.conf just because it ran second.
  router.post('/system/restart-services', async (req, res) => {
    const runStep = async (label: string, step: () => Promise<string>): Promise<{ ok: boolean; message: string }> => {
      try {
        const message = await step();
        activity.log(message, 'blue').catch(() => {});
        return { ok: true, message };
      } catch (err) {
        const message = (err as Error).message;
        activity.log(`${label} failed: ${message}`, 'red').catch(() => {});
        return { ok: false, message };
      }
    };

    const smb = await runStep('SMB restart', async () => {
      const def = SERVICE_DEFS.find((d) => d.id === 'smb')!;
      await restartService(def);
      return 'SMB restarted';
    });
    const nfs = await runStep('NFS restart', async () => {
      const def = SERVICE_DEFS.find((d) => d.id === 'nfs')!;
      await restartService(def);
      return 'NFS restarted';
    });
    const driverReload = await runStep('Driver reload', async () => {
      const result = await nmd.reloadModuleAndImport();
      return `Driver reloaded, ${result.importedCount} disk(s) re-imported`;
    });
    // Docker only reads daemon.json at startup, and restarting it stops every running container -
    // an explicit opt-in from the caller, not run by default, so a restore that never touched
    // daemon.json (or a click of this button outside a restore) doesn't bounce Docker for no
    // reason. The config-restore wizard sets this from commitResult.dockerConfigRestored.
    //
    // The driver reload above only re-imports the superblock - it never mounts array disks (that
    // only happens on a full array start, which this endpoint doesn't perform). If Docker's
    // storage lives on an array disk and the array isn't started, that path is empty right now;
    // restarting dockerd against it makes it initialize fresh empty state there, permanently
    // orphaning every existing container/image (the files stay on disk, but neither dockerd nor
    // containerd's "moby" namespace reference them anymore once mounted later - confirmed live).
    // Skip the bounce in that case; /array/start already restarts Docker correctly once the disk
    // is actually mounted, so there's nothing to do here but explain why it was skipped.
    const dockerStorage = req.body?.restartDocker ? await getConfiguredDockerStorage().catch(() => null) : null;
    const arrayStarted = req.body?.restartDocker ? (await nmd.getStatus()).array.state === 'STARTED' : true;
    const dockerRestartUnsafe = dockerStorage?.mode === 'array' && !arrayStarted;
    const dockerResult = req.body?.restartDocker
      ? dockerRestartUnsafe
        ? { ok: false, message: "Docker storage is on an array disk that isn't mounted yet - start the array to bring Docker back." }
        : await runStep('Docker restart', async () => {
            const def = SERVICE_DEFS.find((d) => d.id === 'docker')!;
            await restartService(def);
            return 'Docker restarted';
          })
      : null;

    activity.log('Restarting nonraid-webui backend', 'amber').catch(() => {});
    res.json({
      smb,
      nfs,
      driverReload,
      docker: dockerResult,
      message: 'Restarting nonraid-webui - this page will reconnect automatically in a few seconds.',
    });
    // Same self-exit pattern as /services/webui/restart: this unit's own Restart=on-failure
    // brings it back, and routing through `systemctl restart` here would just get killed by
    // systemd's stop phase before it could ever reach the start phase.
    res.on('finish', () => {
      setTimeout(() => process.exit(1), 200);
    });
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
        res.status(409).json({ error: 'A parity check or clear is in progress - refusing to benchmark mid-operation.' });
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
        res.status(409).json({ error: 'A parity check or clear is in progress - refusing to benchmark mid-operation.' });
        return;
      }
      // The boot disk's mountpoint is always `/` - no lookup needed, unlike an array disk.
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
      await setHostname(name);
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
      await setTimezone(tz);
      activity.log(`Timezone changed to "${tz}"`, 'blue').catch(() => {});
      res.json({ ok: true, message: `Timezone set to "${tz}".` });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/system/reboot', async (_req, res) => {
    try {
      await rebootHost();
      activity.log('System reboot requested', 'amber').catch(() => {});
      res.json({ ok: true, message: 'Rebooting now - this page will reconnect automatically once the host is back up.' });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
