import { Router, type Response } from 'express';
import { HttpError } from '../httpError.js';
import type { ShareService } from '../shares/index.js';

function handleError(err: unknown, res: Response) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
  } else {
    res.status(502).json({ error: (err as Error).message });
  }
}

export function sharesRouter(shares: ShareService): Router {
  const router = Router();

  router.get('/shares', async (_req, res) => {
    try {
      res.json(await shares.list());
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/shares', async (req, res) => {
    try {
      res.status(201).json(await shares.create(req.body));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.put('/shares/:name', async (req, res) => {
    try {
      res.json(await shares.update(req.params.name, req.body));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.delete('/shares/:name', async (req, res) => {
    try {
      await shares.remove(req.params.name);
      res.json({ ok: true, message: `Share "${req.params.name}" removed` });
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}
