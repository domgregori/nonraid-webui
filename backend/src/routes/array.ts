import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import { Router } from 'express';
import multer from 'multer';
import type { ActivityStore } from '../activity/index.js';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import type { LxcClient } from '../lxc/index.js';
import type { NmdClient } from '../nmd/index.js';
import { matchSlotToDisk, parseSuperblock } from '../nmd/superblock.js';
import type { SettingsStore } from '../settings/index.js';
import { notifyEvent } from '../settings/notify.js';
import type { ShareService } from '../shares/index.js';
import { runSudoMaybe } from '../system/procUtil.js';

// A superblock is always exactly 4096 bytes (see nmd/superblock.ts); this
// limit is just generous headroom so a wrong/oversized file gets multer's
// plain rejection instead of silent truncation, before parseSuperblock()'s
// own exact-length check runs.
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 64 * 1024 } });

interface StagedImport {
  filePath: string;
  uploadedAt: number;
}

// Single-admin, single-session, upload-then-immediately-decide flow — no
// need for a persisted store, just an in-memory map local to this route
// module. Swept lazily (see sweepStagedImports()) rather than on its own
// timer, since this feature is used rarely (once per migration).
const stagedImports = new Map<string, StagedImport>();
const STAGING_TTL_MS = 30 * 60 * 1000;

function sweepStagedImports(): void {
  const cutoff = Date.now() - STAGING_TTL_MS;
  for (const [token, staged] of stagedImports) {
    if (staged.uploadedAt < cutoff) {
      stagedImports.delete(token);
      unlink(staged.filePath).catch(() => {});
    }
  }
}

export function arrayRouter(nmd: NmdClient, settingsStore: SettingsStore, activity: ActivityStore, shares: ShareService, lxc: LxcClient): Router {
  const router = Router();

  router.post('/array/start', async (_req, res) => {
    try {
      const result = await nmd.startArray();
      // The driver forgets write method across a stop/start (no persistence
      // of its own — see nmd/client.ts's setWriteMethod doc comment), so
      // reapply our persisted preference every time, the same way real
      // Unraid's webGUI resends its tunable as part of its own array-start
      // sequence. Best-effort: a failure here shouldn't fail array start.
      const settings = await settingsStore.get();
      if (settings.turboWrite) await nmd.setWriteMethod(true).catch(() => {});

      // nmdctl start activates the array's md device but doesn't mount each
      // disk's own filesystem — do that, then bring shares back up on top of
      // them (mirrors ShareService.unmountAll on the /array/stop side).
      // Best-effort: the array itself did start even if a disk fails to mount.
      try {
        await nmd.mountDisks();
        await shares.remountAll();
      } catch (err) {
        activity.log(`Array started, but mounting disks failed: ${(err as Error).message}`, 'amber').catch(() => {});
      }

      activity.log('Array started', 'green').catch(() => {});
      notifyEvent(settingsStore, 'arrayStarted', 'NonRAID: array started', 'Array started');
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/array/stop', async (_req, res) => {
    try {
      // nmdctl refuses to stop (in unattended mode, always used here) with
      // any disk filesystem still mounted — and a share's mergerfs/bind mount
      // holds a live reference into those disk mounts that nmdctl itself has
      // no idea exists, so both layers need unmounting before nmdctl stop.
      await shares.unmountAll();
      await nmd.unmountDisks();
      const result = await nmd.stopArray();
      activity.log('Array stopped', 'blue').catch(() => {});
      notifyEvent(settingsStore, 'arrayStopped', 'NonRAID: array stopped', 'Array stopped');
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // Guided Unraid-array-import wizard: choose a .dat superblock file, see
  // exactly what it expects and how that lines up against what's physically
  // connected, then explicitly commit. Parsing is done directly on the raw
  // bytes (see nmd/superblock.ts) rather than by loading it into the kernel
  // — nmdctl itself has no dry-run/preview command, so this is the only way
  // to show a genuinely safe, zero-side-effect preview before anything real
  // happens. Replaces the old bare "scan whatever's already loaded" /array/import.
  router.post('/array/import/preview', upload.single('file'), async (req, res) => {
    sweepStagedImports();
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded.' });
      return;
    }
    try {
      const buf = await readFile(file.path);
      const parsed = parseSuperblock(buf); // throws HttpError(400) on bad magic/length
      const disks = await nmd.scanAllDisks();

      const slots = parsed.slots.map((slot) => {
        const match = matchSlotToDisk(slot, disks);
        return {
          slot: slot.slot,
          role: slot.role,
          sizeKb: slot.sizeKb,
          id: slot.id,
          status: match.status,
          matchedDevice: match.disk
            ? { device: match.disk.device, partition: match.disk.partition, model: match.disk.model, sizeKb: match.disk.sizeKb }
            : null,
        };
      });

      // Cheaply predicts the kernel's own ERROR:PARITY_NOT_BIGGEST (confirmed
      // from md_unraid.c) directly from the superblock's own recorded sizes —
      // no physical disk needed for this one.
      const dataSlots = parsed.slots.filter((s) => s.role === 'data');
      const paritySlots = parsed.slots.filter((s) => s.role !== 'data');
      const largestDataKb = dataSlots.length > 0 ? Math.max(...dataSlots.map((s) => s.sizeKb)) : 0;
      const parityTooSmall = paritySlots.some((s) => s.sizeKb < largestDataKb);

      let currentArrayActive = false;
      try {
        currentArrayActive = (await nmd.getStatus()).array.state === 'STARTED';
      } catch {
        currentArrayActive = false; // nothing configured yet — nothing to warn about
      }

      const token = randomUUID();
      stagedImports.set(token, { filePath: file.path, uploadedAt: Date.now() });

      res.json({
        token,
        label: parsed.label,
        slots,
        parityTooSmall,
        currentArrayActive,
        hasSizeMismatch: slots.some((s) => s.status === 'size-mismatch'),
        hasMissing: slots.some((s) => s.status === 'missing'),
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

  router.post('/array/import/commit', async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const staged = token ? stagedImports.get(token) : undefined;
    if (!staged) {
      res.status(400).json({ error: 'This import preview has expired or was already used — upload the file again.' });
      return;
    }
    stagedImports.delete(token);

    try {
      // Re-checked against the live safety gate rather than trusting
      // whatever the client remembers from the original preview response —
      // this is the one thing that hard-blocks with no override.
      const buf = await readFile(staged.filePath);
      const parsed = parseSuperblock(buf);
      const disks = await nmd.scanAllDisks();
      const hasSizeMismatch = parsed.slots.some((slot) => matchSlotToDisk(slot, disks).status === 'size-mismatch');
      if (hasSizeMismatch) {
        res.status(409).json({
          error:
            'Refusing to import — one or more disks have a size mismatch against the superblock. ' +
            'Starting the array like this can corrupt filesystems and lose data; resolve the mismatch first.',
        });
        return;
      }

      // Same reasoning as /array/stop — shares/disk mounts have to come down
      // before the module can be safely unloaded and reloaded.
      await shares.unmountAll().catch(() => {});
      await nmd.unmountDisks().catch(() => {});

      const { result, targetPath, backedUpTo } = await nmd.commitImportedSuperblock(staged.filePath);
      const status = await nmd.getStatus();

      const suffix = backedUpTo ? ` (previous superblock backed up at ${backedUpTo})` : '';
      if (result.errors.length > 0 || status.array.state.startsWith('ERROR:')) {
        activity.log(`Array import completed with issues${suffix} — see Settings for details`, 'amber').catch(() => {});
      } else {
        activity.log(`Imported ${result.importedCount} disk(s) from uploaded superblock${suffix}`, 'blue').catch(() => {});
      }

      res.json({ importResult: result, targetPath, backedUpTo, status });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    } finally {
      await unlink(staged.filePath).catch(() => {});
    }
  });

  router.post('/array/shrink', async (req, res) => {
    const dropSlots = req.body?.dropSlots;
    if (!Array.isArray(dropSlots) || dropSlots.length === 0 || !dropSlots.every((s) => Number.isInteger(s))) {
      res.status(400).json({ error: 'dropSlots must be a non-empty array of slot numbers.' });
      return;
    }
    try {
      // Same reasoning as /array/stop — shares/disk mounts have to come down
      // before nmdctl (which shrinkArray stops internally) will allow it.
      await shares.unmountAll();
      await nmd.unmountDisks();
      const result = await nmd.shrinkArray(dropSlots);
      try {
        await nmd.mountDisks();
        await shares.remountAll();
      } catch (err) {
        activity.log(`Array reconfigured, but remounting disks failed: ${(err as Error).message}`, 'amber').catch(() => {});
      }
      const text = `Array reconfigured, dropping slot(s) ${dropSlots.join(', ')}`;
      activity.log(text, 'amber').catch(() => {});
      notifyEvent(settingsStore, 'arrayReconfigured', 'NonRAID: array reconfigured', text);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/array/reload-driver', async (req, res) => {
    // Opt-in — stopping Docker/every running LXC container is a real disruption, so it only
    // happens if the caller explicitly agreed to it (see the Settings UI's warning) AND it turns
    // out to actually be necessary (unmountDisks() below only fails this way when something has a
    // file open on an array disk, e.g. Docker/LXC storage relocated there — see docker/storagePath.ts
    // and lxc/storagePath.ts for the same class of conflict during a storage move).
    const stopContainers = req.body?.stopContainers === true;
    let dockerStopped = false;
    const stoppedLxcNames: string[] = [];

    try {
      // Best-effort here, unlike /array/stop and /array/shrink — this is a
      // recovery action meant to work from an already-broken state (e.g.
      // ERROR:TOO_MANY_MISSING_DISKS), where the array may already be
      // stopped with nothing mounted; failing the whole recovery because
      // there was nothing to unmount would defeat the point.
      await shares.unmountAll().catch(() => {});
      try {
        await nmd.unmountDisks();
      } catch (err) {
        if (!stopContainers) throw err;

        activity.log('Stopping Docker and running LXC containers to allow the driver reload', 'amber').catch(() => {});
        await runSudoMaybe('systemctl', ['stop', 'docker.socket', 'docker.service'], config.systemUseSudo).catch(() => {});
        dockerStopped = true;

        const containers = await lxc.listContainers().catch(() => []);
        for (const c of containers) {
          if (c.state !== 'running') continue;
          await lxc.stopContainer(c.name).catch(() => {});
          stoppedLxcNames.push(c.name);
        }

        await shares.unmountAll().catch(() => {});
        await nmd.unmountDisks(); // still busy after stopping containers — let this one throw for real
      }

      const result = await nmd.reloadDriver();
      try {
        await nmd.mountDisks();
        await shares.remountAll();
      } catch (err) {
        activity.log(`Driver reloaded, but remounting disks failed: ${(err as Error).message}`, 'amber').catch(() => {});
      }
      activity.log('Driver reloaded to recover from stale array state', 'amber').catch(() => {});
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    } finally {
      // Always try to bring back whatever was stopped, regardless of whether the reload itself
      // ultimately succeeded — leaving Docker/containers down on a failed reload attempt would
      // turn a recovery action into a second outage.
      if (dockerStopped) {
        await runSudoMaybe('systemctl', ['start', 'docker'], config.systemUseSudo).catch(() => {});
      }
      for (const name of stoppedLxcNames) {
        await lxc.startContainer(name).catch(() => {});
      }
      if (dockerStopped || stoppedLxcNames.length > 0) {
        activity.log('Restarted Docker/LXC containers after the driver reload', 'blue').catch(() => {});
      }
    }
  });

  router.put('/array/label', async (req, res) => {
    try {
      const label = typeof req.body?.label === 'string' ? req.body.label : '';
      const result = await nmd.setLabel(label);
      activity.log(label ? `Array label changed to "${label}"` : 'Array label cleared', 'blue').catch(() => {});
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
