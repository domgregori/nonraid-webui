import { Router } from 'express';
import type { ActivityStore } from '../activity/index.js';
import { HttpError } from '../httpError.js';
import { DEFAULT_ARCH } from '../lxc/distros.js';
import type { CreateLxcContainerOptions, LxcClient } from '../lxc/index.js';
import { getCurrentLxcStorage, migrateLxcStorage } from '../lxc/storagePath.js';
import type { NmdClient } from '../nmd/index.js';
import type { SettingsStore } from '../settings/index.js';
import type { StorageLocation } from '../settings/types.js';

// Container names become directory names under lxcDefaultPath
// (`<lxcDefaultPath>/<name>/`) and are interpolated into config-file paths
// on disk — reject anything that isn't a safe, plain identifier before it
// ever reaches path.join, so a name like "../../etc" can't escape the
// container storage root.
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

function requireValidName(name: string): string {
  if (!NAME_RE.test(name)) {
    throw new HttpError(400, `Invalid container name "${name}" — use letters, numbers, "_", "-", "." only`);
  }
  return name;
}

// These end up as lines in the container's real LXC config file (see
// backend/src/lxc/configFile.ts) — a line break here would let one field's
// value inject arbitrary extra lxc.* directives, so reject it up front
// rather than relying solely on configFile.ts's own check.
function requireNoLineBreaks(field: string, value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new HttpError(400, `${field} must not contain line breaks`);
  }
  return value;
}

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

export function lxcRouter(lxc: LxcClient, activity: ActivityStore, nmd: NmdClient, settingsStore: SettingsStore): Router {
  const router = Router();

  router.get('/lxc/storage', async (_req, res) => {
    try {
      res.json(await getCurrentLxcStorage(settingsStore));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // Streams newline-delimited JSON progress events, same protocol as container creation below —
  // stopping containers, copying potentially many GB, and restarting them can take a while.
  router.post('/lxc/storage', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
    const send = (event: object) => res.write(`${JSON.stringify(event)}\n`);
    try {
      const target = parseStorageLocation(req.body);
      const result = await migrateLxcStorage(target, { nmd, lxc, settingsStore }, (progress) => send({ type: 'progress', ...progress }));
      activity.log(`LXC storage moved to ${result.path}`, 'blue').catch(() => {});
      send({ type: 'done', result });
    } catch (err) {
      const message = err instanceof HttpError ? err.message : (err as Error).message;
      send({ type: 'error', message });
    } finally {
      res.end();
    }
  });

  router.get('/lxc/containers', async (_req, res) => {
    try {
      res.json(await lxc.listContainers());
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.get('/lxc/distros', async (_req, res) => {
    try {
      res.json(await lxc.listDistros());
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.get('/lxc/bridges', async (_req, res) => {
    try {
      res.json(await lxc.listBridges());
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.get('/lxc/containers/:name', async (req, res) => {
    try {
      res.json(await lxc.inspectContainer(requireValidName(req.params.name)));
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.post('/lxc/containers/:name/start', async (req, res) => {
    try {
      const name = requireValidName(req.params.name);
      const result = await lxc.startContainer(name);
      activity.log(`LXC container "${name}" started`, 'blue').catch(() => {});
      res.json(result);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.post('/lxc/containers/:name/stop', async (req, res) => {
    try {
      const name = requireValidName(req.params.name);
      const force = req.body?.force === true;
      const result = await lxc.stopContainer(name, { force });
      activity.log(`LXC container "${name}" stopped`, 'blue').catch(() => {});
      res.json(result);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.post('/lxc/containers/:name/restart', async (req, res) => {
    try {
      const name = requireValidName(req.params.name);
      const result = await lxc.restartContainer(name);
      activity.log(`LXC container "${name}" restarted`, 'blue').catch(() => {});
      res.json(result);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.delete('/lxc/containers/:name', async (req, res) => {
    try {
      const name = requireValidName(req.params.name);
      const result = await lxc.destroyContainer(name);
      activity.log(`LXC container "${name}" destroyed`, 'red').catch(() => {});
      res.json(result);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.get('/lxc/containers/:name/config', async (req, res) => {
    try {
      const name = requireValidName(req.params.name);
      res.json({ content: await lxc.getConfigText(name) });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.put('/lxc/containers/:name/config', async (req, res) => {
    try {
      const name = requireValidName(req.params.name);
      if (typeof req.body?.content !== 'string') throw new HttpError(400, 'content is required');
      const result = await lxc.setConfigText(name, req.body.content);
      activity.log(`LXC container "${name}" config updated`, 'blue').catch(() => {});
      res.json(result);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  // Streams newline-delimited JSON progress events — same protocol as the
  // Docker/Apps create endpoints (see backend/src/routes/docker.ts), since
  // a rootfs download can take long enough for a silent blocking response
  // to read as hung.
  router.post('/lxc/containers', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
    const send = (event: object) => res.write(`${JSON.stringify(event)}\n`);
    try {
      const body = req.body ?? {};
      const name = requireValidName(String(body.name ?? ''));
      if (!body.distribution || !body.release) {
        throw new HttpError(400, 'distribution and release are required');
      }
      const options: CreateLxcContainerOptions = {
        name,
        distribution: String(body.distribution),
        release: String(body.release),
        arch: String(body.arch || DEFAULT_ARCH),
        bridge: String(body.bridge || ''),
        autostart: body.autostart === true,
        description: requireNoLineBreaks('description', String(body.description ?? '')),
        webUiUrl: requireNoLineBreaks('webUiUrl', String(body.webUiUrl ?? '')),
      };
      if (!options.bridge) throw new HttpError(400, 'bridge is required');
      const validBridges = await lxc.listBridges();
      if (!validBridges.includes(options.bridge)) {
        throw new HttpError(400, `Invalid bridge "${options.bridge}" — must be one of: ${validBridges.join(', ')}`);
      }

      const result = await lxc.createContainer(options, (progress) => send({ type: 'progress', ...progress }));
      activity.log(`LXC container "${name}" created`, 'green').catch(() => {});
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
