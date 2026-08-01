import { Router } from 'express';
import type { DockerClient } from '../docker/index.js';
import { buildManualPlan } from '../docker/manualPlan.js';
import { HttpError } from '../httpError.js';

export function dockerRouter(docker: DockerClient, bindRoots: string[]): Router {
  const router = Router();

  router.get('/docker/containers', async (_req, res) => {
    try {
      res.json(await docker.listContainers());
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.get('/docker/containers/:id', async (req, res) => {
    try {
      res.json(await docker.inspectContainer(req.params.id));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.get('/docker/containers/:id/logs', async (req, res) => {
    try {
      const tail = Number(req.query.tail);
      res.json({ logs: await docker.getContainerLogs(req.params.id, Number.isInteger(tail) && tail > 0 ? tail : undefined) });
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

  router.post('/docker/containers/plan', async (req, res) => {
    try {
      res.json(await buildManualPlan(req.body, bindRoots));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // Streams newline-delimited JSON progress events, same protocol as the Apps
  // install endpoint — see backend/src/routes/apps.ts for why (a plain image
  // pull can take long enough that a silent blocking response reads as hung).
  router.post('/docker/containers', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
    const send = (event: object) => res.write(`${JSON.stringify(event)}\n`);
    try {
      const plan = await buildManualPlan(req.body, bindRoots);
      if (plan.errors.length > 0) throw new HttpError(400, `Cannot create container: ${plan.errors.join('; ')}`);
      if (plan.requiresPrivilegedAck && req.body?.privilegedAck !== true) {
        throw new HttpError(400, `Requires elevated host access (${plan.elevatedAccessReasons.join(' ')}). Set privilegedAck: true to confirm.`);
      }
      const result = await docker.createContainer(
        {
          name: plan.containerName,
          image: plan.image,
          network: plan.network,
          privileged: plan.privileged,
          env: plan.env.map((e) => `${e.name}=${e.value}`),
          ports: plan.ports,
          binds: plan.binds.map((b) => `${b.hostPath}:${b.containerPath}${b.readOnly ? ':ro' : ''}`),
          devices: plan.devices.map((d) => ({ hostPath: d.hostPath, containerPath: d.containerPath })),
          labels: {},
        },
        (progress) => send({ type: 'progress', ...progress }),
      );
      send({ type: 'done', result });
    } catch (err) {
      const message = err instanceof HttpError ? err.message : (err as Error).message;
      send({ type: 'error', message });
    } finally {
      res.end();
    }
  });

  // Docker containers are immutable once created — "editing" one means
  // stopping and removing the old container, then creating a new one with
  // the requested config. The old container's labels are carried over onto
  // the new one (not caller-suppliable) so a Community-Applications-installed
  // container is still recognized as installed after being edited.
  router.put('/docker/containers/:id', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
    const send = (event: object) => res.write(`${JSON.stringify(event)}\n`);
    try {
      const existing = await docker.inspectContainer(req.params.id);
      const plan = await buildManualPlan(req.body, bindRoots);
      if (plan.errors.length > 0) throw new HttpError(400, `Cannot update container: ${plan.errors.join('; ')}`);
      if (plan.requiresPrivilegedAck && req.body?.privilegedAck !== true) {
        throw new HttpError(400, `Requires elevated host access (${plan.elevatedAccessReasons.join(' ')}). Set privilegedAck: true to confirm.`);
      }

      send({ type: 'progress', phase: 'removing', message: `Removing "${existing.name}"`, percent: null });
      await docker.stopContainer(req.params.id).catch(() => {});
      await docker.removeContainer(req.params.id, { force: true });

      const result = await docker.createContainer(
        {
          name: plan.containerName,
          image: plan.image,
          network: plan.network,
          privileged: plan.privileged,
          env: plan.env.map((e) => `${e.name}=${e.value}`),
          ports: plan.ports,
          binds: plan.binds.map((b) => `${b.hostPath}:${b.containerPath}${b.readOnly ? ':ro' : ''}`),
          devices: plan.devices.map((d) => ({ hostPath: d.hostPath, containerPath: d.containerPath })),
          labels: existing.labels,
        },
        (progress) => send({ type: 'progress', ...progress }),
      );
      send({ type: 'done', result });
    } catch (err) {
      const message = err instanceof HttpError ? err.message : (err as Error).message;
      send({ type: 'error', message });
    } finally {
      res.end();
    }
  });

  return router;
}
