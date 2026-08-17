import { Router } from 'express';
import type { ActivityStore } from '../activity/index.js';
import { getServiceState, restartService, SERVICE_DEFS, startService, stopService, type ServiceState } from '../system/services.js';

export function servicesRouter(activity: ActivityStore): Router {
  const router = Router();

  router.get('/services', async (_req, res) => {
    try {
      const rows: Array<{ id: string; label: string; state: ServiceState }> = await Promise.all(
        SERVICE_DEFS.map(async (def) => ({ id: def.id, label: def.label, state: await getServiceState(def) })),
      );
      // Synthesized row: if this endpoint answered, the backend serving it is up.
      rows.push({ id: 'webui', label: 'nonraid-webui (this app)', state: 'active' });
      res.json(rows);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/services/:id/start', async (req, res) => {
    const def = SERVICE_DEFS.find((d) => d.id === req.params.id);
    if (!def) {
      res.status(req.params.id === 'webui' ? 400 : 404).json({ error: req.params.id === 'webui' ? 'webui only supports restart.' : 'Unknown service.' });
      return;
    }
    try {
      await startService(def);
      activity.log(`${def.label} started`, 'blue').catch(() => {});
      res.json({ ok: true, message: `${def.label} started.` });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/services/:id/stop', async (req, res) => {
    const def = SERVICE_DEFS.find((d) => d.id === req.params.id);
    if (!def) {
      res.status(req.params.id === 'webui' ? 400 : 404).json({ error: req.params.id === 'webui' ? 'webui only supports restart.' : 'Unknown service.' });
      return;
    }
    try {
      await stopService(def);
      activity.log(`${def.label} stopped`, 'amber').catch(() => {});
      res.json({ ok: true, message: `${def.label} stopped.` });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/services/:id/restart', async (req, res) => {
    // nonraid-webui.service is this backend's own unit - routing its restart through
    // `systemctl restart` would spawn a child process inside the unit's own cgroup, which
    // systemd's stop phase would kill before it could ever trigger the start phase. The unit has
    // Restart=on-failure (RestartSec=5), so a clean self-restart instead just exits non-zero and
    // lets systemd bring it back up.
    if (req.params.id === 'webui') {
      activity.log('Restarting nonraid-webui backend', 'amber').catch(() => {});
      res.json({ ok: true, message: 'Restarting - this page will reconnect automatically in a few seconds.' });
      res.on('finish', () => {
        setTimeout(() => process.exit(1), 200);
      });
      return;
    }

    const def = SERVICE_DEFS.find((d) => d.id === req.params.id);
    if (!def) {
      res.status(404).json({ error: 'Unknown service.' });
      return;
    }
    try {
      await restartService(def);
      activity.log(`${def.label} restarted`, 'amber').catch(() => {});
      res.json({ ok: true, message: `${def.label} restarted.` });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
