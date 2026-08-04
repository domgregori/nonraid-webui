import { Router } from 'express';
import type { ActivityStore } from '../activity/index.js';
import type { NmdClient } from '../nmd/index.js';
import type { SettingsStore } from '../settings/index.js';
import type { ShareService } from '../shares/index.js';

export function arrayRouter(nmd: NmdClient, settingsStore: SettingsStore, activity: ActivityStore, shares: ShareService): Router {
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
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/array/import', async (_req, res) => {
    try {
      const status = await nmd.getStatus();
      if (status.array.state === 'STARTED') {
        res.status(400).json({ error: 'Stop the array before importing — nmdctl import only applies to a stopped array.' });
        return;
      }
      const result = await nmd.importDisks();
      if (result.sizeMismatches.length > 0) {
        const slots = result.sizeMismatches.map((m) => m.slot).join(', ');
        activity.log(`Import found a size mismatch on slot(s) ${slots} — do not start the array until resolved`, 'red').catch(() => {});
      } else if (result.errors.length > 0) {
        activity.log('Import completed with errors — see Settings for details', 'amber').catch(() => {});
      } else {
        activity.log(`Imported ${result.importedCount} disk(s)`, 'blue').catch(() => {});
      }
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
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
