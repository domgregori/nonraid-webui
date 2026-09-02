import { execFile } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CacheService } from '../cache/service.js';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import type { NmdClient } from '../nmd/index.js';
import type { StorageLocation } from '../settings/types.js';
import { runSudoMaybe } from '../system/procUtil.js';
import type { DockerClient } from './client.js';
import { isAllowedBindPath } from './planning.js';

const execFileAsync = promisify(execFile);
// Exported so backupCatalog.ts can back this up under the same name a relocated Docker storage
// root is written to - without it, a config restore onto a fresh OS install would leave Docker
// pointed at the default data-root, unaware any previously-relocated containers/images exist.
export const DAEMON_JSON_PATH = '/etc/docker/daemon.json';

export interface StoragePathProgress {
  phase: string;
  message: string;
}

export interface DockerStorageInfo {
  // 'custom' covers both a data-root this app didn't set (e.g. hand-edited outside the
  // boot/array/cache convention) and one an admin typed directly (see StorageLocation's own doc
  // comment for why this app doesn't try to guess a pool subfolder on the admin's behalf).
  mode: 'boot' | 'array' | 'cache' | 'custom';
  diskSlot: number | null;
  path: string;
}

/** Boot → today's real default; array disk N / the cache pool → a fixed subfolder, same convention
 *  as the LXC side (lxc/storagePath.ts) so the three are easy to reason about together. Anything
 *  else (a pool, or any other path) is 'custom' - the admin types the exact target rather than
 *  picking a pool by name and getting a fixed "/system/docker" suffix appended underneath it,
 *  which silently doubled up for anyone whose pool happened to be named "system" itself. */
export function resolveDockerPath(location: StorageLocation): string {
  if (location.mode === 'boot') return '/var/lib/docker';
  if (location.mode === 'cache') return `${config.cacheMountPoint}/system/docker`;
  if (location.mode === 'custom') {
    if (!location.customPath) throw new Error('customPath is required when mode is "custom".');
    return location.customPath;
  }
  if (location.diskSlot === null) throw new Error('diskSlot is required when mode is "array".');
  return `/mnt/disk${location.diskSlot}/system/docker`;
}

function classifyDockerStorage(currentPath: string): DockerStorageInfo {
  if (currentPath === '/var/lib/docker') return { mode: 'boot', diskSlot: null, path: currentPath };
  if (currentPath === `${config.cacheMountPoint}/system/docker`) return { mode: 'cache', diskSlot: null, path: currentPath };
  const match = currentPath.match(/^\/mnt\/disk(\d+)\/system\/docker$/);
  if (match) return { mode: 'array', diskSlot: Number(match[1]), path: currentPath };
  return { mode: 'custom', diskSlot: null, path: currentPath };
}

export async function getCurrentDockerStorage(docker: DockerClient): Promise<DockerStorageInfo> {
  return classifyDockerStorage(await docker.getDataRoot());
}

/** Same classification as getCurrentDockerStorage(), but read straight from daemon.json instead of
 *  querying the live daemon - needed for callers that may run while dockerd itself is stopped
 *  (e.g. deciding whether it's safe to restart Docker in the first place). */
export async function getConfiguredDockerStorage(): Promise<DockerStorageInfo> {
  const raw = await readFile(DAEMON_JSON_PATH, 'utf8').catch(() => null);
  const dataRoot = raw ? (JSON.parse(raw) as { 'data-root'?: string })['data-root'] : undefined;
  return classifyDockerStorage(dataRoot ?? '/var/lib/docker');
}

/** Same "don't move onto a mirror that can't actually serve the data" gate for both cache
 *  consumers (Docker here, LXC in lxc/storagePath.ts) - not-configured or fully unavailable
 *  refuses outright; degraded (single-disk, no redundancy but still fully readable/writable) is
 *  allowed, matching how the cache pool itself stays usable in that state. */
async function requireCacheUsable(cache: CacheService): Promise<void> {
  const status = await cache.getStatus();
  if (status.health === 'not-configured' || status.health === 'unavailable') {
    throw new HttpError(400, `Cache pool isn't available (${status.health}) - set it up on the Disks page first.`);
  }
}

/** A typed custom path has to resolve inside one of this app's own bind roots (config.appsBindRoots
 *  - same trust boundary a manually-typed container bind mount already has to clear, see
 *  docker/planning.ts's isAllowedBindPath) before Docker gets pointed at it - without this, a typo
 *  or a deliberately hostile value could point Docker's entire data-root at /etc, /root, or
 *  anywhere else outside the array/pool space this app is willing to let it write. */
async function requireAllowedCustomPath(customPath: string): Promise<void> {
  if (!(await isAllowedBindPath(customPath, config.appsBindRoots))) {
    throw new HttpError(400, `"${customPath}" isn't inside an allowed location - it needs to be under ${config.appsBindRoots.join(' or ')}.`);
  }
}

/** Walks up from `targetPath` to the nearest directory that already exists, for a free-space check
 *  during the 'checking' phase below - the target leaf itself (and any number of its parents) may
 *  not exist yet for a freshly-typed custom path, unlike the boot/array/cache presets, which always
 *  resolve under a mountpoint that's guaranteed to already be there. Falls back to '/' (always
 *  exists) rather than looping forever. */
async function nearestExistingAncestor(targetPath: string): Promise<string> {
  let dir = targetPath;
  for (let i = 0; i < 32; i++) {
    if (await pathExists(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return dir;
    dir = parent;
  }
  return '/';
}

// One storage move at a time, system-wide - see lxc/storagePath.ts's identical lock for why.
let running = false;

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (running) throw new Error('A storage move is already running - wait for it to finish first.');
  running = true;
  try {
    return await fn();
  } finally {
    running = false;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function dirSizeBytes(dirPath: string): Promise<number> {
  if (!(await pathExists(dirPath))) return 0;
  const { stdout } = await execFileAsync('du', ['-sb', dirPath]);
  return Number(stdout.split(/\s+/)[0]) || 0;
}

async function freeSpaceBytes(mountPath: string): Promise<number> {
  const { stdout } = await execFileAsync('df', ['-B1', '--output=avail', mountPath]);
  const lines = stdout.trim().split('\n');
  return Number(lines[lines.length - 1]) || 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stops the Docker service entirely (both the socket unit and the daemon, so socket-activation
 * can't silently relaunch dockerd mid-copy), rsyncs /var/lib/docker's contents to the new location,
 * points daemon.json's data-root at it, restarts the service, and polls `docker info` until it
 * reports the new root. Containers without a restart policy simply stay stopped after this - normal
 * Docker behavior, not something this handles specially. Never deletes the old data.
 */
export async function migrateDockerStorage(
  target: StorageLocation,
  deps: { nmd: NmdClient; docker: DockerClient; cache: CacheService },
  onProgress: (p: StoragePathProgress) => void,
): Promise<{ path: string }> {
  return withLock(async () => {
    const currentPath = await deps.docker.getDataRoot();
    const targetPath = resolveDockerPath(target);
    if (targetPath === currentPath) {
      throw new Error('Docker storage is already at this location.');
    }

    const status = await deps.nmd.getStatus();
    if (status.resync.active) {
      throw new Error('A parity check or clear is in progress - refusing to move storage mid-operation.');
    }
    if (target.mode === 'array') {
      const disk = status.disks.find((d) => d.slot === target.diskSlot);
      if (!disk || disk.type !== 'data' || !disk.filesystem || disk.filesystem.mountpoint === 'unmounted') {
        throw new Error(`Disk ${target.diskSlot} isn't a mounted data disk.`);
      }
    }
    if (target.mode === 'cache') {
      await requireCacheUsable(deps.cache);
    }
    if (target.mode === 'custom') {
      await requireAllowedCustomPath(targetPath);
    }

    onProgress({ phase: 'checking', message: 'Checking available space…' });
    const sourceSize = await dirSizeBytes(currentPath);
    const targetMount =
      target.mode === 'array' ? `/mnt/disk${target.diskSlot}` : target.mode === 'cache' ? config.cacheMountPoint : await nearestExistingAncestor(targetPath);
    const available = await freeSpaceBytes(targetMount);
    if (sourceSize > 0 && available < sourceSize * 1.1) {
      throw new Error(`Not enough free space at the target - needs about ${Math.ceil((sourceSize * 1.1) / 1024 / 1024)} MB.`);
    }

    onProgress({ phase: 'stopping', message: 'Stopping the Docker service…' });
    await runSudoMaybe('systemctl', ['stop', 'docker.socket', 'docker.service']);

    onProgress({ phase: 'copying', message: `Copying data to ${targetPath}…` });
    await runSudoMaybe('mkdir', ['-p', targetPath]);
    if (await pathExists(currentPath)) {
      await runSudoMaybe('rsync', ['-a', `${currentPath}/`, `${targetPath}/`]);
    }

    onProgress({ phase: 'reconfiguring', message: 'Updating Docker configuration…' });
    let daemonConfig: Record<string, unknown> = {};
    try {
      daemonConfig = JSON.parse(await readFile(DAEMON_JSON_PATH, 'utf8'));
    } catch {
      // missing, or unreadable without privilege - start fresh rather than blocking the move on a
      // pre-existing file this app doesn't own
    }
    daemonConfig['data-root'] = targetPath;
    const tmpPath = path.join(os.tmpdir(), `nonraid-daemon-${process.pid}.json`);
    await writeFile(tmpPath, JSON.stringify(daemonConfig, null, 2), 'utf8');
    await runSudoMaybe('mkdir', ['-p', path.dirname(DAEMON_JSON_PATH)]);
    await runSudoMaybe('mv', [tmpPath, DAEMON_JSON_PATH]);

    onProgress({ phase: 'starting', message: 'Starting the Docker service…' });
    await runSudoMaybe('systemctl', ['start', 'docker']);

    onProgress({ phase: 'verifying', message: 'Waiting for Docker to come back up…' });
    let verified = false;
    for (let i = 0; i < 15 && !verified; i++) {
      await sleep(1000);
      try {
        verified = (await deps.docker.getDataRoot()) === targetPath;
      } catch {
        // still starting - retry
      }
    }
    if (!verified) {
      throw new Error('Docker restarted but did not report the new storage location - check `docker info` and the service status manually.');
    }

    onProgress({
      phase: 'done',
      message: `Done. Old data is still at ${currentPath} - remove it manually once you've verified everything works.`,
    });
    return { path: targetPath };
  });
}
