import { Router } from 'express';
import { APP_NAME_LABEL, APP_REPOSITORY_LABEL, type AppsService } from '../apps/index.js';
import { resolveWebUiTemplate } from '../apps/webUi.js';
import type { ActivityStore } from '../activity/index.js';
import type { CacheService } from '../cache/service.js';
import type { DockerClient, DockerContainerSummary } from '../docker/index.js';
import { listAvailableDevices } from '../docker/devices.js';
import { buildManualPlan } from '../docker/manualPlan.js';
import { getCurrentDockerStorage, migrateDockerStorage } from '../docker/storagePath.js';
import { checkAllContainers, lastKnownStatus, type ContainerUpdateStatus } from '../docker/updateCheck.js';
import { HttpError } from '../httpError.js';
import type { NmdClient } from '../nmd/index.js';
import type { StorageLocation } from '../settings/types.js';
import { provisionArrayDir } from '../system/arrayDir.js';

function parseStorageLocation(body: unknown): StorageLocation {
  const mode = (body as { mode?: unknown })?.mode;
  if (mode !== 'boot' && mode !== 'array' && mode !== 'cache') {
    throw new HttpError(400, 'mode must be "boot", "array", or "cache".');
  }
  if (mode !== 'array') return { mode, diskSlot: null };
  const diskSlot = (body as { diskSlot?: unknown })?.diskSlot;
  if (typeof diskSlot !== 'number' || !Number.isInteger(diskSlot) || diskSlot < 0) {
    throw new HttpError(400, 'diskSlot is required and must be a non-negative integer when mode is "array".');
  }
  return { mode, diskSlot };
}

export function dockerRouter(
  docker: DockerClient,
  bindRoots: string[],
  apps: AppsService,
  activity: ActivityStore,
  nmd: NmdClient,
  cache: CacheService,
): Router {
  const router = Router();

  router.get('/docker/storage', async (_req, res) => {
    try {
      res.json(await getCurrentDockerStorage(docker));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // Streams newline-delimited JSON progress events, same protocol as container creation below -
  // stopping the Docker service, copying potentially many GB, and restarting it can take a while.
  router.post('/docker/storage', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
    const send = (event: object) => res.write(`${JSON.stringify(event)}\n`);
    try {
      const target = parseStorageLocation(req.body);
      const result = await migrateDockerStorage(target, { nmd, docker, cache }, (progress) => send({ type: 'progress', ...progress }));
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
  // dependency direction - Apps depends on Docker, not the reverse), so a
  // container's real WebUI link, when it has a resolvable one, is filled in
  // here at the route boundary instead: look up the CA app the labels point
  // to, and resolve its WebUI field against this container's *actual*
  // current port mappings (not whatever the template's install-time default
  // was - ports may have changed since via an edit). Containers without CA
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

  // start/stop/restart only get an id from the client, not a name - fetch it
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

  // Curated /dev subdirectories (GPU, audio, stable-named serial) for the
  // create/edit dialog's Device picker - see docker/devices.ts for why this
  // isn't a flat dump of all of /dev. Also used by the Apps install dialog
  // for Config entries of Type="Device".
  router.get('/docker/devices', async (_req, res) => {
    try {
      res.json(await listAvailableDevices());
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // Real Docker networks (custom + built-in bridge/host/none) for the create/edit dialog's
  // Network dropdown.
  router.get('/docker/networks', async (_req, res) => {
    try {
      res.json(await docker.listNetworks());
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
      const since = req.query.since !== undefined ? Number(req.query.since) : undefined;
      if (since !== undefined && !Number.isFinite(since)) {
        throw new Error('since must be a number.');
      }
      res.json(await docker.getContainerLogs(req.params.id, Number.isInteger(tail) && tail > 0 ? tail : undefined, since));
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

  router.put('/docker/containers/:id/autostart', async (req, res) => {
    try {
      const name = await containerName(req.params.id);
      const autostart = req.body?.autostart === true;
      const result = await docker.updateContainerAutostart(req.params.id, autostart);
      activity.log(`Container "${name}" autostart ${autostart ? 'enabled' : 'disabled'}`, 'blue').catch(() => {});
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
      activity.log(`Container "${name}" destroyed - ${result.message}`, 'red').catch(() => {});
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
  // install endpoint - see backend/src/routes/apps.ts for why (a plain image
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
      // See apps/service.ts's install() for why this runs before createContainer - Docker itself
      // would otherwise auto-create a missing bind-mount host path as root:root with no ACL.
      for (const bind of plan.binds) {
        if (bind.allowed) await provisionArrayDir(bind.hostPath);
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
          autostart: plan.autostart,
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

  // Docker containers are immutable once created - "editing" one means
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

      for (const bind of plan.binds) {
        if (bind.allowed) await provisionArrayDir(bind.hostPath);
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
          labels: existing.labels,
          autostart: plan.autostart,
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

  // Cheap, cached - whatever the last check found for every currently-listed container (or the
  // all-null/unknown shape for one never checked yet). Safe to call on every Docker page load,
  // same "cached vs. forced live check" split as the nonraid update system's own /update/status.
  router.get('/docker/update-status', async (_req, res) => {
    try {
      const containers = await docker.listContainers();
      const statuses: Record<string, ContainerUpdateStatus> = {};
      for (const c of containers) statuses[c.id] = lastKnownStatus(c.id);
      res.json(statuses);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // Explicit "Check for updates now" for every container - the only route here that actually
  // pulls every image. checkAllContainers is best-effort per container, so one failing doesn't
  // block the rest.
  router.post('/docker/update-status/check', async (_req, res) => {
    try {
      const results = await checkAllContainers(docker);
      const statuses: Record<string, ContainerUpdateStatus> = {};
      for (const s of results) statuses[s.containerId] = s;
      res.json(statuses);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // Pulls the container's own image reference fresh, then recreates it with its own existing
  // config unchanged (same stop -> force-remove -> createContainer sequence
  // PUT /docker/containers/:id uses, but built directly from inspectContainer's own result rather
  // than a caller-supplied plan - nothing about the config is changing here). Works identically
  // for a Community-Apps-installed container or a manually-created "custom" one; the mechanism
  // only needs an image reference.
  router.post('/docker/containers/:id/update-now', async (req, res) => {
    try {
      const existing = await docker.inspectContainer(req.params.id);
      await docker.pullImage(existing.image);
      await docker.stopContainer(req.params.id).catch(() => {});
      await docker.removeContainer(req.params.id, { force: true });
      const result = await docker.createContainer({
        name: existing.name,
        image: existing.image,
        network: existing.network,
        privileged: existing.privileged,
        env: existing.env.map((e) => `${e.name}=${e.value}`),
        ports: existing.ports,
        binds: existing.binds.map((b) => `${b.hostPath}:${b.containerPath}${b.readOnly ? ':ro' : ''}`),
        devices: existing.devices,
        labels: existing.labels,
        autostart: existing.autostart,
      });
      activity.log(`Container "${existing.name}" updated to a newer image`, 'green').catch(() => {});
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
