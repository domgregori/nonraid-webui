import { randomUUID } from 'node:crypto';
import { copyFile, readdir, readFile, realpath, stat, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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

// Single-admin, single-session, upload-then-immediately-decide flow - no
// need for a persisted store, just an in-memory map local to this route
// module. Swept lazily (see sweepStagedImports()) rather than on its own
// timer, since this feature is used rarely (once per migration).
const stagedImports = new Map<string, StagedImport>();
const STAGING_TTL_MS = 30 * 60 * 1000;

/**
 * After mountDisks() reports success, nmdctl's own mount step can still silently skip a disk
 * whose filesystem it didn't mount as expected - a skip, unlike a real per-disk mount error,
 * doesn't affect nmdctl's exit code, so the try/catch around mountDisks() at each call site below
 * never sees it. Re-checks live status and logs a warning naming any data disk that has a
 * detected filesystem but still isn't mounted, so it doesn't go unnoticed - this exact situation
 * left three disks DISK_OK/"unmounted" through several array starts, each reporting clean
 * success. Disks with no filesystem at all are skipped - that's the normal state for a genuinely
 * blank new disk awaiting Format, not a problem worth flagging.
 */
async function warnUnmountedDataDisks(nmd: NmdClient, activity: ActivityStore): Promise<void> {
  try {
    const status = await nmd.getStatus();
    const stuck = status.disks.filter((d) => d.type === 'data' && d.filesystem?.type && d.filesystem.mountpoint === 'unmounted');
    if (stuck.length === 0) return;
    const names = stuck.map((d) => `Disk ${d.slot} (${d.filesystem!.type})`).join(', ');
    activity.log(`${names} still not mounted after mounting disks - try Mount Disk from the Disks page.`, 'amber').catch(() => {});
  } catch {
    // best-effort - a status-fetch failure here shouldn't compound whatever's already happening
  }
}

function sweepStagedImports(): void {
  const cutoff = Date.now() - STAGING_TTL_MS;
  for (const [token, staged] of stagedImports) {
    if (staged.uploadedAt < cutoff) {
      stagedImports.delete(token);
      unlink(staged.filePath).catch(() => {});
    }
  }
}

/**
 * Shared by /array/import/preview (browser upload) and /array/import/preview-from-path (locate
 * an existing .dat already on this host's own root filesystem) - both end up with identical raw
 * bytes on disk at this point, so from here the preview response is built identically regardless
 * of how the file got there. Stages the bytes under `stagedImports` so /array/import/commit (also
 * shared) can re-validate against live disk state right before doing anything real.
 */
async function buildImportPreview(nmd: NmdClient, buf: Buffer, stagedPath: string) {
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

  // Cheaply predicts the kernel's own ERROR:PARITY_NOT_BIGGEST (confirmed from the kernel driver's
  // own source) directly from the superblock's own recorded sizes - no physical disk needed for this one.
  const dataSlots = parsed.slots.filter((s) => s.role === 'data');
  const paritySlots = parsed.slots.filter((s) => s.role !== 'data');
  const largestDataKb = dataSlots.length > 0 ? Math.max(...dataSlots.map((s) => s.sizeKb)) : 0;
  const parityTooSmall = paritySlots.some((s) => s.sizeKb < largestDataKb);

  let currentArrayActive = false;
  try {
    currentArrayActive = (await nmd.getStatus()).array.state === 'STARTED';
  } catch {
    currentArrayActive = false; // nothing configured yet - nothing to warn about
  }

  const token = randomUUID();
  stagedImports.set(token, { filePath: stagedPath, uploadedAt: Date.now() });

  return {
    token,
    label: parsed.label,
    slots,
    parityTooSmall,
    currentArrayActive,
    hasSizeMismatch: slots.some((s) => s.status === 'size-mismatch'),
    hasMissing: slots.some((s) => s.status === 'missing'),
  };
}

// Directories that are pointless to offer when locating a superblock backup - pseudo-filesystems
// with huge or synthetic content, never a real place to keep a .dat file. Not a security boundary
// (browse-root's whole point is "the same filesystem the backend already trusts and reads
// /nonraid.dat from" - see the route below), just keeping the listing usable.
const SKIP_LISTING_ENTRIES = new Set(['proc', 'sys', 'dev', 'run']);

interface BrowseEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
}

/**
 * Resolves an untrusted path against the real filesystem root ("/") for the import-locate
 * picker. Unlike browse/paths.ts (deliberately scoped to config.shareMountRoot for the
 * user-facing file browser), this one is allowed to see the whole root filesystem on purpose -
 * the backend already reads /nonraid.dat straight off this same filesystem for every status
 * poll, so there's no new trust boundary crossed by letting an authenticated admin browse it
 * read-only to find a backup copy. realpath() still collapses any ".."/symlink games down to a
 * concrete path before use.
 */
async function resolveRootPath(requested: string): Promise<string> {
  const resolved = path.resolve('/', requested || '/');
  try {
    return await realpath(resolved);
  } catch {
    throw new HttpError(400, `"${requested}" doesn't exist or isn't readable.`);
  }
}

export function arrayRouter(nmd: NmdClient, settingsStore: SettingsStore, activity: ActivityStore, shares: ShareService, lxc: LxcClient): Router {
  const router = Router();

  router.post('/array/start', async (_req, res) => {
    try {
      const result = await nmd.startArray();
      // The driver forgets write method across a stop/start (no persistence
      // of its own - see nmd/client.ts's setWriteMethod doc comment), so
      // reapply our persisted preference every time, the same pattern other
      // array-management webGUIs use to resend their own tunable as part of
      // their own array-start sequence. Best-effort: a failure here shouldn't fail array start.
      const settings = await settingsStore.get();
      if (settings.turboWrite) await nmd.setWriteMethod(true).catch(() => {});

      // nmdctl start activates the array's md device but doesn't mount each
      // disk's own filesystem - do that, then bring shares back up on top of
      // them (mirrors ShareService.unmountAll on the /array/stop side).
      // Best-effort: the array itself did start even if a disk fails to mount.
      try {
        await nmd.mountDisks();
        await warnUnmountedDataDisks(nmd, activity);
        await shares.remountAll();
      } catch (err) {
        activity.log(`Array started, but mounting disks failed: ${(err as Error).message}`, 'amber').catch(() => {});
      }

      // Best-effort recovery from /array/stop's own stopContainers path (see there for why a
      // successful stop never restarts Docker/LXC itself): if that left docker.service stopped -
      // e.g. the array was stopped, then started again in the same session without anyone manually
      // restarting Docker - bring it back now so its own containers (any with a real restart
      // policy - this app doesn't set one on the ones it creates, so most won't self-start) at
      // least have a running daemon to restart against. LXC has no daemon-level equivalent - each
      // container's own `autostart` (lxc.start.auto) is normally only honored by lxc's systemd
      // unit at a real host boot, not when this app starts/stops containers mid-session - so it's
      // applied explicitly here instead.
      await runSudoMaybe('systemctl', ['start', 'docker']).catch(() => {});
      try {
        const containers = await lxc.listContainers();
        const started: string[] = [];
        for (const c of containers) {
          if (!c.autostart || c.state === 'running') continue;
          await lxc.startContainer(c.name).catch(() => {});
          started.push(c.name);
        }
        if (started.length > 0) {
          activity.log(`Started autostart LXC container(s): ${started.join(', ')}`, 'blue').catch(() => {});
        }
      } catch {
        // best-effort - a failure listing/starting LXC containers shouldn't fail array start itself
      }

      activity.log('Array started', 'green', 'arrayStarted').catch(() => {});
      notifyEvent(settingsStore, 'arrayStarted', 'NonRAID: array started', 'Array started');
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/array/stop', async (req, res) => {
    // Opt-in - stopping Docker/every running LXC container is a real disruption, so it only
    // happens if the caller explicitly agreed to it AND it turns out to actually be necessary
    // (unmountDisks() below only fails this way when something has a file open on an array disk -
    // e.g. Docker's own data root relocated there via Settings -> Docker & LXC Storage, not just a
    // container's bind-mounted volume - see docker/storagePath.ts and lxc/storagePath.ts for the
    // same class of conflict during a storage move). Unlike /array/reload-driver, a *successful*
    // stop here never restarts Docker/LXC afterward - their storage lives on the array disk that's
    // about to be unmounted, so there'd be nothing left for them to run against. Only restarted if
    // the stop attempt still fails even after stopping them, so a failed attempt doesn't leave
    // Docker/LXC down for nothing while the array keeps running.
    const stopContainers = req.body?.stopContainers === true;
    let dockerStopped = false;
    const stoppedLxcNames: string[] = [];

    try {
      // nmdctl refuses to stop (in unattended mode, always used here) with
      // any disk filesystem still mounted - and a share's mergerfs/bind mount
      // holds a live reference into those disk mounts that nmdctl itself has
      // no idea exists, so both layers need unmounting before nmdctl stop.
      await shares.unmountAll();
      try {
        await nmd.unmountDisks();
      } catch (err) {
        if (!stopContainers) throw err;

        activity.log('Stopping Docker and running LXC containers to allow the array to stop', 'amber').catch(() => {});
        await runSudoMaybe('systemctl', ['stop', 'docker.socket', 'docker.service']).catch(() => {});
        dockerStopped = true;

        const containers = await lxc.listContainers().catch(() => []);
        for (const c of containers) {
          if (c.state !== 'running') continue;
          await lxc.stopContainer(c.name).catch(() => {});
          stoppedLxcNames.push(c.name);
        }

        await shares.unmountAll().catch(() => {});
        await nmd.unmountDisks(); // still busy after stopping containers - let this one throw for real
      }

      const result = await nmd.stopArray();
      activity.log('Array stopped', 'blue', 'arrayStopped').catch(() => {});
      notifyEvent(settingsStore, 'arrayStopped', 'NonRAID: array stopped', 'Array stopped');
      res.json(result);
    } catch (err) {
      // The stop attempt itself failed (or never got past unmountDisks) - restore whatever we
      // stopped along the way, since the array is still running and there's no reason for
      // Docker/LXC to stay down.
      if (dockerStopped) {
        await runSudoMaybe('systemctl', ['start', 'docker']).catch(() => {});
      }
      for (const name of stoppedLxcNames) {
        await lxc.startContainer(name).catch(() => {});
      }
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // Guided array-import wizard: choose a .dat superblock file, see
  // exactly what it expects and how that lines up against what's physically
  // connected, then explicitly commit. Parsing is done directly on the raw
  // bytes (see nmd/superblock.ts) rather than by loading it into the kernel
  // - nmdctl itself has no dry-run/preview command, so this is the only way
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
      const preview = await buildImportPreview(nmd, buf, file.path);
      res.json(preview);
    } catch (err) {
      await unlink(file.path).catch(() => {});
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(502).json({ error: (err as Error).message });
      }
    }
  });

  // Where nmdctl itself looks for a superblock by default - checked directly so the wizard can
  // offer it as a one-click option before falling back to browsing or uploading.
  router.get('/array/import/default-path', async (_req, res) => {
    try {
      const importPath = await nmd.getSuperblockPath();
      const exists = await stat(importPath)
        .then(() => true)
        .catch(() => false);
      res.json({ path: importPath, exists });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // Lists real subdirectories and .dat files under an absolute path on this host's own root
  // filesystem - the "locate on disk" half of the import wizard's file picker, for hosts (like
  // this one) where the boot/OS disk is the same filesystem the backend itself runs on, not a
  // separate flash drive the way some other array-appliance OSes use. Read-only; see resolveRootPath() above for scope.
  router.get('/array/import/browse-root', async (req, res) => {
    const requested = typeof req.query.path === 'string' ? req.query.path : '/';
    try {
      const real = await resolveRootPath(requested);
      const st = await stat(real);
      if (!st.isDirectory()) {
        res.status(400).json({ error: `"${real}" is not a directory.` });
        return;
      }
      const dirents = await readdir(real, { withFileTypes: true });
      const entries: BrowseEntry[] = [];
      for (const d of dirents) {
        if (real === '/' && SKIP_LISTING_ENTRIES.has(d.name)) continue;
        if (d.isDirectory()) {
          entries.push({ name: d.name, path: path.join(real, d.name), type: 'dir' });
        } else if (d.isFile() && d.name.toLowerCase().endsWith('.dat')) {
          entries.push({ name: d.name, path: path.join(real, d.name), type: 'file' });
        }
      }
      entries.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
      res.json({ path: real, parent: real === '/' ? null : path.dirname(real), entries });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(400).json({ error: `Can't read "${requested}": ${(err as Error).message}` });
      }
    }
  });

  // Same preview as the upload flow, but sourced from a path already on this host rather than a
  // browser upload - the file is copied into a private tmp location first (never referenced by
  // its original path past this point), so /array/import/commit's cleanup can never delete the
  // user's own original copy.
  router.post('/array/import/preview-from-path', async (req, res) => {
    sweepStagedImports();
    const requested = typeof req.body?.path === 'string' ? req.body.path : '';
    if (!requested) {
      res.status(400).json({ error: 'path is required.' });
      return;
    }
    if (!requested.toLowerCase().endsWith('.dat')) {
      res.status(400).json({ error: 'Only .dat files can be imported.' });
      return;
    }
    let tmpPath: string | null = null;
    try {
      const real = await resolveRootPath(requested);
      const st = await stat(real);
      if (!st.isFile()) {
        res.status(400).json({ error: `"${real}" is not a file.` });
        return;
      }
      tmpPath = path.join(os.tmpdir(), `nmd-import-${randomUUID()}.dat`);
      await copyFile(real, tmpPath);
      const buf = await readFile(tmpPath);
      const preview = await buildImportPreview(nmd, buf, tmpPath);
      res.json({ ...preview, sourcePath: real });
    } catch (err) {
      if (tmpPath) await unlink(tmpPath).catch(() => {});
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(400).json({ error: `Can't read "${requested}": ${(err as Error).message}` });
      }
    }
  });

  router.post('/array/import/commit', async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const staged = token ? stagedImports.get(token) : undefined;
    if (!staged) {
      res.status(400).json({ error: 'This import preview has expired or was already used - upload the file again.' });
      return;
    }
    stagedImports.delete(token);

    try {
      // Re-checked against the live safety gate rather than trusting
      // whatever the client remembers from the original preview response -
      // this is the one thing that hard-blocks with no override.
      const buf = await readFile(staged.filePath);
      const parsed = parseSuperblock(buf);
      const disks = await nmd.scanAllDisks();
      const hasSizeMismatch = parsed.slots.some((slot) => matchSlotToDisk(slot, disks).status === 'size-mismatch');
      if (hasSizeMismatch) {
        res.status(409).json({
          error:
            'Refusing to import - one or more disks have a size mismatch against the superblock. ' +
            'Starting the array like this can corrupt filesystems and lose data; resolve the mismatch first.',
        });
        return;
      }

      // Same reasoning as /array/stop - shares/disk mounts have to come down
      // before the module can be safely unloaded and reloaded.
      await shares.unmountAll().catch(() => {});
      await nmd.unmountDisks().catch(() => {});

      const { result, targetPath, backedUpTo } = await nmd.commitImportedSuperblock(staged.filePath);
      const status = await nmd.getStatus();

      const suffix = backedUpTo ? ` (previous superblock backed up at ${backedUpTo})` : '';
      if (result.errors.length > 0 || status.array.state.startsWith('ERROR:')) {
        activity.log(`Array import completed with issues${suffix} - see Settings for details`, 'amber').catch(() => {});
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
      // Same reasoning as /array/stop - shares/disk mounts have to come down
      // before nmdctl (which shrinkArray stops internally) will allow it.
      await shares.unmountAll();
      await nmd.unmountDisks();
      const result = await nmd.shrinkArray(dropSlots);
      try {
        await nmd.mountDisks();
        await warnUnmountedDataDisks(nmd, activity);
        await shares.remountAll();
      } catch (err) {
        activity.log(`Array reconfigured, but remounting disks failed: ${(err as Error).message}`, 'amber').catch(() => {});
      }
      const text = `Array reconfigured, dropping slot(s) ${dropSlots.join(', ')}`;
      activity.log(text, 'amber', 'arrayReconfigured').catch(() => {});
      notifyEvent(settingsStore, 'arrayReconfigured', 'NonRAID: array reconfigured', text);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/array/reload-driver', async (req, res) => {
    // Opt-in - stopping Docker/every running LXC container is a real disruption, so it only
    // happens if the caller explicitly agreed to it (see the Settings UI's warning) AND it turns
    // out to actually be necessary (unmountDisks() below only fails this way when something has a
    // file open on an array disk, e.g. Docker/LXC storage relocated there - see docker/storagePath.ts
    // and lxc/storagePath.ts for the same class of conflict during a storage move).
    const stopContainers = req.body?.stopContainers === true;
    let dockerStopped = false;
    const stoppedLxcNames: string[] = [];

    try {
      // Best-effort here, unlike /array/stop and /array/shrink - this is a
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
        await runSudoMaybe('systemctl', ['stop', 'docker.socket', 'docker.service']).catch(() => {});
        dockerStopped = true;

        const containers = await lxc.listContainers().catch(() => []);
        for (const c of containers) {
          if (c.state !== 'running') continue;
          await lxc.stopContainer(c.name).catch(() => {});
          stoppedLxcNames.push(c.name);
        }

        await shares.unmountAll().catch(() => {});
        await nmd.unmountDisks(); // still busy after stopping containers - let this one throw for real
      }

      const result = await nmd.reloadDriver();
      try {
        await nmd.mountDisks();
        await warnUnmountedDataDisks(nmd, activity);
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
      // ultimately succeeded - leaving Docker/containers down on a failed reload attempt would
      // turn a recovery action into a second outage.
      if (dockerStopped) {
        await runSudoMaybe('systemctl', ['start', 'docker']).catch(() => {});
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
