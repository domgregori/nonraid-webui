import { Router } from 'express';
import { ArrayNotConfiguredError, type NmdClient } from '../nmd/index.js';

export function statusRouter(nmd: NmdClient): Router {
  const router = Router();

  router.get('/status', async (_req, res) => {
    try {
      res.json(await nmd.getStatus());
    } catch (err) {
      // A genuinely fresh install (no array ever created) is a well-known, expected state, not a
      // real failure - 404 ("this resource doesn't exist yet") plus a `code` the frontend can key
      // off of, rather than the generic 502 every other getStatus() failure gets, so the dashboard
      // can route into onboarding instead of showing an error banner.
      if (err instanceof ArrayNotConfiguredError) {
        res.status(404).json({ error: err.message, code: 'ARRAY_NOT_CONFIGURED' });
        return;
      }
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
