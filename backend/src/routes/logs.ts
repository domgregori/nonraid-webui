import { Router } from 'express';
import type { SettingsStore } from '../settings/store.js';
import { LOG_SOURCE_DEFS, queryLog, windowMsFor } from '../system/logs.js';

export function logsRouter(settingsStore: SettingsStore): Router {
  const router = Router();

  router.get('/logs/sources', async (_req, res) => {
    // Same reasoning as routes/services.ts's own SERVICE_DEFS filter - Tailscale's log tab only
    // makes sense once the feature's actually switched on; an always-empty tab for a service
    // nobody enabled is just noise. Avahi has no such gate - it's always running (see
    // install-webui.sh's systemctl enable --now), same as NFS/SMB/SSH.
    const settings = await settingsStore.get();
    const sources = LOG_SOURCE_DEFS.filter((s) => s.id !== 'tailscale' || settings.tailscale.enabled);
    res.json(sources.map((s) => ({ id: s.id, label: s.label })));
  });

  router.get('/logs/:sourceId', async (req, res) => {
    const source = LOG_SOURCE_DEFS.find((s) => s.id === req.params.sourceId);
    if (!source) {
      res.status(404).json({ error: 'Unknown log source.' });
      return;
    }

    const tail = req.query.tail !== undefined ? Number(req.query.tail) : undefined;
    const since = req.query.since !== undefined ? Number(req.query.since) : undefined;
    if (since !== undefined && !Number.isFinite(since)) {
      res.status(400).json({ error: 'since must be a number.' });
      return;
    }
    const windowId = typeof req.query.window === 'string' ? req.query.window : undefined;

    try {
      const result = await queryLog(source, { tail, windowMs: since === undefined ? windowMsFor(windowId) : null, sinceCursor: since });
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
