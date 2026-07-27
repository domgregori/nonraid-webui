import { Router } from 'express';
import type { DockerClient } from '../docker/index.js';

export function dockerRouter(docker: DockerClient): Router {
  const router = Router();

  router.get('/docker/containers', async (_req, res) => {
    try {
      res.json(await docker.listContainers());
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/docker/containers/:id/start', async (req, res) => {
    try {
      res.json(await docker.startContainer(req.params.id));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/docker/containers/:id/stop', async (req, res) => {
    try {
      res.json(await docker.stopContainer(req.params.id));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/docker/containers/:id/restart', async (req, res) => {
    try {
      res.json(await docker.restartContainer(req.params.id));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
