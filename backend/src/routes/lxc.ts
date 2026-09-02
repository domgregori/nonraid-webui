import { Router } from 'express';
import type { ActivityStore } from '../activity/index.js';
import type { CacheService } from '../cache/service.js';
import { HttpError } from '../httpError.js';
import { DEFAULT_ARCH } from '../lxc/distros.js';
import type { CreateLxcContainerOptions, LxcClient } from '../lxc/index.js';
import { getCurrentLxcStorage, migrateLxcStorage } from '../lxc/storagePath.js';
import { pruneTemplateCache } from '../lxc/templateCache.js';
import type { NmdClient } from '../nmd/index.js';
import type { SettingsStore } from '../settings/index.js';
import type { StorageLocation } from '../settings/types.js';

// Container names become directory names under lxcDefaultPath
// (`<lxcDefaultPath>/<name>/`) and are interpolated into config-file paths
// on disk - reject anything that isn't a safe, plain identifier before it
// ever reaches path.join, so a name like "../../etc" can't escape the
// container storage root.
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

function requireValidName(name: string): string {
  if (!NAME_RE.test(name)) {
    throw new HttpError(400, `Invalid container name "${name}" - use letters, numbers, "_", "-", "." only`);
  }
  return name;
}

// These end up as lines in the container's real LXC config file (see
// backend/src/lxc/configFile.ts) - a line break here would let one field's
// value inject arbitrary extra lxc.* directives, so reject it up front
// rather than relying solely on configFile.ts's own check.
function requireNoLineBreaks(field: string, value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new HttpError(400, `${field} must not contain line breaks`);
  }
  return value;
}

// Snapshot names are passed as standalone execFile args (never through a shell), so this isn't
// about injection - it's to stop a value like "-P" or "--help" from being misread as a flag by
// lxc-snapshot itself, and to keep names sane before they're shown back in the UI.
const SNAPSHOT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

function requireValidSnapshotName(name: string): string {
  if (!SNAPSHOT_NAME_RE.test(name)) {
    throw new HttpError(400, `Invalid snapshot name "${name}"`);
  }
  return name;
}

function parseStorageLocation(body: unknown): StorageLocation {
  const mode = (body as { mode?: unknown })?.mode;
  if (mode !== 'boot' && mode !== 'array' && mode !== 'cache' && mode !== 'custom') {
    throw new HttpError(400, 'mode must be "boot", "array", "cache", or "custom".');
  }
  if (mode === 'array') {
    const diskSlot = (body as { diskSlot?: unknown })?.diskSlot;
    if (typeof diskSlot !== 'number' || !Number.isInteger(diskSlot) || diskSlot < 0) {
      throw new HttpError(400, 'diskSlot is required and must be a non-negative integer when mode is "array".');
    }
    return { mode, diskSlot, customPath: null };
  }
  if (mode === 'custom') {
    const customPath = (body as { customPath?: unknown })?.customPath;
    if (typeof customPath !== 'string' || !customPath.trim().startsWith('/')) {
      throw new HttpError(400, 'customPath is required and must be an absolute path when mode is "custom".');
    }
    return { mode, diskSlot: null, customPath: customPath.trim() };
  }
  return { mode, diskSlot: null, customPath: null };
}

export function lxcRouter(lxc: LxcClient, activity: ActivityStore, nmd: NmdClient, settingsStore: SettingsStore, cache: CacheService): Router {
  const router = Router();

  router.get('/lxc/storage', async (_req, res) => {
    try {
      res.json(await getCurrentLxcStorage(settingsStore));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // Streams newline-delimited JSON progress events, same protocol as container creation below -
  // stopping containers, copying potentially many GB, and restarting them can take a while.
  router.post('/lxc/storage', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
    const send = (event: object) => res.write(`${JSON.stringify(event)}\n`);
    try {
      const target = parseStorageLocation(req.body);
      const result = await migrateLxcStorage(target, { nmd, lxc, settingsStore, cache }, (progress) => send({ type: 'progress', ...progress }));
      activity.log(`LXC storage moved to ${result.path}`, 'blue').catch(() => {});
      send({ type: 'done', result });
    } catch (err) {
      const message = err instanceof HttpError ? err.message : (err as Error).message;
      send({ type: 'error', message });
    } finally {
      res.end();
    }
  });

  router.post('/lxc/template-cache/prune', async (_req, res) => {
    try {
      const result = await pruneTemplateCache();
      const mb = (result.spaceReclaimedBytes / 1024 / 1024).toFixed(0);
      activity.log(`Cleared LXC template cache, reclaimed ${mb} MB`, 'blue').catch(() => {});
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
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

  router.get('/lxc/interfaces', async (_req, res) => {
    try {
      res.json(await lxc.listPhysicalInterfaces());
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

  router.put('/lxc/containers/:name/autostart', async (req, res) => {
    try {
      const name = requireValidName(req.params.name);
      const autostart = req.body?.autostart === true;
      const result = await lxc.setContainerAutostart(name, autostart);
      activity.log(`LXC container "${name}" autostart ${autostart ? 'enabled' : 'disabled'}`, 'blue').catch(() => {});
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

  router.get('/lxc/containers/:name/snapshots', async (req, res) => {
    try {
      const name = requireValidName(req.params.name);
      res.json(await lxc.listSnapshots(name));
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.post('/lxc/containers/:name/snapshots', async (req, res) => {
    try {
      const name = requireValidName(req.params.name);
      const comment = requireNoLineBreaks('comment', String(req.body?.comment ?? ''));
      const result = await lxc.createSnapshot(name, comment);
      activity.log(`Snapshot created for LXC container "${name}"`, 'blue').catch(() => {});
      res.json(result);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.post('/lxc/containers/:name/snapshots/:snapshotName/restore', async (req, res) => {
    try {
      const name = requireValidName(req.params.name);
      const snapshotName = requireValidSnapshotName(req.params.snapshotName);
      const newName = requireValidName(String(req.body?.newName ?? ''));
      const result = await lxc.restoreSnapshot(name, snapshotName, newName);
      const verb = newName === name ? 'restored in place' : `restored as new container "${newName}"`;
      activity.log(`LXC container "${name}" ${verb} from snapshot ${snapshotName}`, newName === name ? 'amber' : 'green').catch(() => {});
      res.json(result);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.delete('/lxc/containers/:name/snapshots/:snapshotName', async (req, res) => {
    try {
      const name = requireValidName(req.params.name);
      const snapshotName = requireValidSnapshotName(req.params.snapshotName);
      const result = await lxc.deleteSnapshot(name, snapshotName);
      activity.log(`Snapshot ${snapshotName} deleted from LXC container "${name}"`, 'blue').catch(() => {});
      res.json(result);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  // Streams newline-delimited JSON progress events - same protocol as the
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
      const networkType = body.networkType === 'macvlan' ? 'macvlan' : 'bridge';
      const options: CreateLxcContainerOptions = {
        name,
        distribution: String(body.distribution),
        release: String(body.release),
        arch: String(body.arch || DEFAULT_ARCH),
        networkType,
        bridge: String(body.bridge || ''),
        autostart: body.autostart === true,
        description: requireNoLineBreaks('description', String(body.description ?? '')),
        webUiUrl: requireNoLineBreaks('webUiUrl', String(body.webUiUrl ?? '')),
      };
      if (!options.bridge) {
        throw new HttpError(400, networkType === 'macvlan' ? 'A network interface is required.' : 'bridge is required');
      }
      // Re-validated against a fresh list rather than trusting the client, same discipline every
      // other device-picking flow in this app already uses.
      const validLinks = networkType === 'macvlan' ? await lxc.listPhysicalInterfaces() : await lxc.listBridges();
      if (!validLinks.includes(options.bridge)) {
        const noun = networkType === 'macvlan' ? 'network interface' : 'bridge';
        throw new HttpError(400, `Invalid ${noun} "${options.bridge}" - must be one of: ${validLinks.join(', ')}`);
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
