import { Router } from 'express';
import { APP_NAME_LABEL, APP_REPOSITORY_LABEL, type AppsService } from '../apps/index.js';
import { resolveWebUiTemplate } from '../apps/webUi.js';
import type { ActivityStore } from '../activity/index.js';
import type { DockerClient, DockerContainerSummary } from '../docker/index.js';
import { buildManualPlan } from '../docker/manualPlan.js';
import { getCurrentDockerStorage, migrateDockerStorage } from '../docker/storagePath.js';
import { HttpError } from '../httpError.js';
import type { NmdClient } from '../nmd/index.js';
import type { StorageLocation } from '../settings/types.js';

function parseStorageLocation(body: unknown): StorageLocation {
  const mode = (body as { mode?: unknown })?.mode;
  if (mode !== 'boot' && mode !== 'array') {
    throw new HttpError(400, 'mode must be "boot" or "array".');
  }
  if (mode === 'boot') return { mode, diskSlot: null };
  const diskSlot = (body as { diskSlot?: unknown })?.diskSlot;
  if (typeof diskSlot !== 'number' || !Number.isInteger(diskSlot) || diskSlot < 0) {
    throw new HttpError(400, 'diskSlot is required and must be a non-negative integer when mode is "array".');
  }
  return { mode, diskSlot };
}

export function dockerRouter(docker: DockerClient, bindRoots: string[], apps: AppsService, activity: ActivityStore, nmd: NmdClient): Router {
  const router = Router();

  router.get('/docker/storage', async (_req, res) => {
    try {
      res.json(await getCurrentDockerStorage(docker));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // Streams newline-delimited JSON progress events, same protocol as container creation below —
  // stopping the Docker service, copying potentially many GB, and restarting it can take a while.
  router.post('/docker/storage', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
    const send = (event: object) => res.write(`${JSON.stringify(event)}\n`);
    try {
      const target = parseStorageLocation(req.body);
      const result = await migrateDockerStorage(target, { nmd, docker }, (progress) => send({ type: 'progress', ...progress }));
      activity.log(`Docker storage moved to ${result.path}`, 'blue').catch(() => {});
      send({ type: 'done', result });
    } catch (err) {
      const message = err instanceof HttpError ? err.message : (err as Error).message;
      send({ type: 'error', message });
    } finally {
      res.end();
    }
  });

  // The Docker layer itself has no notion of CA templates (kept as a clean
  // dependency direction — Apps depends on Docker, not the reverse), so a
  // container's real WebUI link, when it has a resolvable one, is filled in
  // here at the route boundary instead: look up the CA app the labels point
  // to, and resolve its WebUI field against this container's *actual*
  // current port mappings (not whatever the template's install-time default
  // was — ports may have changed since via an edit). Containers without CA
  // labels, or whose CA app can no longer be found in the feed (e.g.
  // delisted), just keep the client-side "first published port" fallback.
  async function withWebUiUrl(container: DockerContainerSummary): Promise<DockerContainerSummary> {
    const appName = container.labels[APP_NAME_LABEL];
    if (!appName) return container;
    try {
      const app = await apps.getApp(appName, container.labels[APP_REPOSITORY_LABEL]);
      return { ...container, webUiUrl: resolveWebUiTemplate(app.WebUI, container.portMappings) };
    } catch {
      return container;
    }
  }

  // start/stop/restart only get an id from the client, not a name — fetch it
  // first purely so the activity entry reads like "jellyfin stopped" instead
  // of a container id. Best-effort: falls back to the id if inspect fails.
  async function containerName(id: string): Promise<string> {
    return docker
      .inspectContainer(id)
      .then((c) => c.name)
      .catch(() => id);
  }

  router.get('/docker/containers', async (_req, res) => {
    try {
      res.json(await Promise.all((await docker.listContainers()).map(withWebUiUrl)));
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
      const name = await containerName(req.params.id);
      const result = await docker.startContainer(req.params.id);
      activity.log(`Container "${name}" started`, 'blue').catch(() => {});
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/docker/containers/:id/stop', async (req, res) => {
    try {
      const name = await containerName(req.params.id);
      const result = await docker.stopContainer(req.params.id);
      activity.log(`Container "${name}" stopped`, 'blue').catch(() => {});
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/docker/containers/:id/restart', async (req, res) => {
    try {
      const name = await containerName(req.params.id);
      const result = await docker.restartContainer(req.params.id);
      activity.log(`Container "${name}" restarted`, 'blue').catch(() => {});
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.delete('/docker/containers/:id', async (req, res) => {
    try {
      const name = await containerName(req.params.id);
      const result = await docker.destroyContainer(req.params.id);
      activity.log(`Container "${name}" destroyed — ${result.message}`, 'red').catch(() => {});
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post('/docker/images/prune', async (_req, res) => {
    try {
      const result = await docker.pruneImages();
      const mb = (result.spaceReclaimedBytes / 1024 / 1024).toFixed(0);
      activity.log(`Pruned ${result.imagesDeleted} unused Docker image(s), reclaimed ${mb} MB`, 'blue').catch(() => {});
      res.json(result);
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
      activity.log(`Container "${plan.containerName}" created`, 'green').catch(() => {});
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
      activity.log(`Container "${plan.containerName}" updated`, 'blue').catch(() => {});
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
