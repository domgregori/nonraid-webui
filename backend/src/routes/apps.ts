import { Router, type Response } from 'express';
import type { AppsService } from '../apps/index.js';
import type { AppSort } from '../apps/types.js';
import { HttpError } from '../httpError.js';

const SORTS: AppSort[] = ['trending', 'latest', 'new'];

function handleError(err: unknown, res: Response) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
  } else {
    res.status(502).json({ error: (err as Error).message });
  }
}

export function appsRouter(apps: AppsService): Router {
  const router = Router();

  router.get('/apps', async (req, res) => {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const category = typeof req.query.category === 'string' ? req.query.category : undefined;
      const sort = SORTS.find((s) => s === req.query.sort);
      res.json(await apps.listSummaries({ search, category, sort }));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/apps/categories', async (_req, res) => {
    try {
      res.json(await apps.listCategories());
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/apps/meta', async (_req, res) => {
    try {
      res.json(await apps.getFeedMeta());
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/apps/refresh', async (_req, res) => {
    try {
      await apps.refreshFeed();
      res.json(await apps.getFeedMeta());
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/apps/:name', async (req, res) => {
    try {
      const repository = typeof req.query.repository === 'string' ? req.query.repository : undefined;
      res.json(await apps.getApp(req.params.name, repository));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/apps/:name/plan', async (req, res) => {
    try {
      res.json(
        await apps.buildPlan({
          name: req.params.name,
          repository: req.body?.repository,
          containerName: req.body?.containerName,
          overrides: req.body?.overrides,
          privilegedAck: req.body?.privilegedAck,
        }),
      );
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/apps/:name/install', async (req, res) => {
    try {
      const { result } = await apps.install({
        name: req.params.name,
        repository: req.body?.repository,
        containerName: req.body?.containerName,
        overrides: req.body?.overrides,
        privilegedAck: req.body?.privilegedAck,
      });
      res.json(result);
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}
