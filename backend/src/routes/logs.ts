import { Router } from 'express';
import { LOG_SOURCE_DEFS, queryLog, windowMsFor } from '../system/logs.js';

export function logsRouter(): Router {
  const router = Router();

  router.get('/logs/sources', (_req, res) => {
    res.json(LOG_SOURCE_DEFS.map((s) => ({ id: s.id, label: s.label })));
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
