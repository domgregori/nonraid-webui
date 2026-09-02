import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CacheService } from '../cache/service.js';
import { config } from '../config.js';
import { isAllowedBindPath } from '../docker/planning.js';
import { HttpError } from '../httpError.js';
import type { NmdClient } from '../nmd/index.js';
import type { SettingsStore } from '../settings/index.js';
import type { StorageLocation } from '../settings/types.js';
import { runSudoMaybe } from '../system/procUtil.js';
import { getVariable, setVariable } from './configFile.js';
import type { LxcClient } from './client.js';

const execFileAsync = promisify(execFile);

// LXC's own global config - read by every lxc-* tool (including lxc-autostart, called with no -P
// flag by the stock lxc.service unit) whenever it needs a default lxcpath and none was given
// explicitly. Same role as Docker's /etc/docker/daemon.json data-root: without keeping this in
// sync, relocating LXC storage moves this app's own view of where containers live
// (config.lxcDefaultPath) but leaves the *system's* autostart-at-real-boot mechanism still
// scanning the old (now empty, for an array/cache move) default - confirmed live: after a move,
// lxc.service's own lxc-autostart never found the relocated containers at all, so nothing with
// lxc.start.auto=1 ever came back up on a real reboot, independent of this app entirely.
const LXC_GLOBAL_CONF = '/etc/lxc/lxc.conf';

export interface StoragePathProgress {
  phase: string;
  message: string;
}

/** Boot → today's real default; array disk N / the cache pool → a fixed subfolder, same convention
 *  as the Docker side (docker/storagePath.ts) so the three are easy to reason about together.
 *  Anything else (a pool, or any other path) is 'custom' - the admin types the exact target rather
 *  than picking a pool by name and getting a fixed "/system/lxc" suffix appended underneath it,
 *  which silently doubled up for anyone whose pool happened to be named "system" itself. */
export function resolveLxcPath(location: StorageLocation): string {
  if (location.mode === 'boot') return '/var/lib/lxc';
  if (location.mode === 'cache') return `${config.cacheMountPoint}/system/lxc`;
  if (location.mode === 'custom') {
    if (!location.customPath) throw new Error('customPath is required when mode is "custom".');
    return location.customPath;
  }
  if (location.diskSlot === null) throw new Error('diskSlot is required when mode is "array".');
  return `/mnt/disk${location.diskSlot}/system/lxc`;
}

/** Same "don't move onto a mirror that can't actually serve the data" gate as the Docker side. */
async function requireCacheUsable(cache: CacheService): Promise<void> {
  const status = await cache.getStatus();
  if (status.health === 'not-configured' || status.health === 'unavailable') {
    throw new HttpError(400, `Cache pool isn't available (${status.health}) - set it up on the Disks page first.`);
  }
}

/** Same "has to resolve inside an allowed bind root" gate as the Docker side (see
 *  docker/storagePath.ts's requireAllowedCustomPath). */
async function requireAllowedCustomPath(customPath: string): Promise<void> {
  if (!(await isAllowedBindPath(customPath, config.appsBindRoots))) {
    throw new HttpError(400, `"${customPath}" isn't inside an allowed location - it needs to be under ${config.appsBindRoots.join(' or ')}.`);
  }
}

/** Same ancestor-walk as the Docker side (see docker/storagePath.ts's nearestExistingAncestor) -
 *  a freshly-typed custom path's leaf (or several of its parents) may not exist yet. */
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

// One storage move at a time, system-wide - concurrent moves (or a move racing a benchmark's own
// heavy I/O) would contend for bandwidth and leave things in a confusing half-done state.
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

export async function getCurrentLxcStorage(settingsStore: SettingsStore): Promise<StorageLocation & { path: string }> {
  const settings = await settingsStore.get();
  return { ...settings.lxcStorage, path: resolveLxcPath(settings.lxcStorage) };
}

/**
 * lxc.rootfs.path is written as an absolute path (typically an overlay spec,
 * `overlay:<lxcpath>/<name>/rootfs:<lxcpath>/<name>/overlay/delta`, baked in at container-create
 * time by lxc-create/lxc-copy) - rsync-ing a container's directory to a new lxcpath does not
 * update this, so without rewriting it here, every relocated container silently keeps depending on
 * its OLD location for its actual rootfs. That's invisible right up until the old location is
 * removed - which is exactly what migrateLxcStorage()'s own "done" message below tells the admin
 * to do once they've verified the move - at which point every relocated container fails to start.
 * Confirmed live: found via a container that broke exactly this way.
 */
async function rewriteRootfsPaths(oldPrefix: string, newPrefix: string, containerRoot: string): Promise<void> {
  const entries = await readdir(containerRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const configPath = path.join(containerRoot, entry.name, 'config');
    const rootfsPath = await getVariable(configPath, 'lxc.rootfs.path');
    if (rootfsPath && rootfsPath.includes(oldPrefix)) {
      await setVariable(configPath, 'lxc.rootfs.path', rootfsPath.split(oldPrefix).join(newPrefix));
    }
  }
}

/**
 * Stops any running containers, rsyncs the container directory tree to the new location, rewrites
 * each container's lxc.rootfs.path to match (see rewriteRootfsPaths above), switches
 * config.lxcDefaultPath (read fresh by every lxc-* call in realClient.ts - no restart needed) and
 * persists the choice, then restarts whatever was running. Never deletes the old data - leaves it
 * in place so a failed verification doesn't mean lost containers, at the cost of temporary double
 * disk usage until the admin removes it by hand.
 */
export async function migrateLxcStorage(
  target: StorageLocation,
  deps: { nmd: NmdClient; lxc: LxcClient; settingsStore: SettingsStore; cache: CacheService },
  onProgress: (p: StoragePathProgress) => void,
): Promise<{ path: string }> {
  return withLock(async () => {
    const currentPath = config.lxcDefaultPath;
    const targetPath = resolveLxcPath(target);
    if (targetPath === currentPath) {
      throw new Error('LXC storage is already at this location.');
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

    onProgress({ phase: 'stopping', message: 'Stopping running LXC containers…' });
    const containers = await deps.lxc.listContainers();
    const runningNames = containers.filter((c) => c.state === 'running').map((c) => c.name);
    for (const name of runningNames) {
      await deps.lxc.stopContainer(name);
    }

    onProgress({ phase: 'copying', message: `Copying data to ${targetPath}…` });
    await runSudoMaybe('mkdir', ['-p', targetPath]);
    if (await pathExists(currentPath)) {
      await runSudoMaybe('rsync', ['-a', `${currentPath}/`, `${targetPath}/`]);
      await rewriteRootfsPaths(currentPath, targetPath, targetPath);
    }

    onProgress({ phase: 'switching', message: 'Switching to the new location…' });
    config.lxcDefaultPath = targetPath;
    await deps.settingsStore.update({ lxcStorage: target });
    // Keep LXC's own global default in step - see LXC_GLOBAL_CONF's doc comment. Best-effort: a
    // failure here shouldn't fail the whole move, since this app's own lxc-* calls (which all
    // pass an explicit path derived from config.lxcDefaultPath) already work correctly regardless
    // - only the system's own autostart-at-boot depends on this file being right.
    await setVariable(LXC_GLOBAL_CONF, 'lxc.lxcpath', targetPath).catch(() => {});

    if (runningNames.length > 0) {
      onProgress({ phase: 'restarting', message: 'Restarting containers…' });
      for (const name of runningNames) {
        await deps.lxc.startContainer(name).catch(() => {});
      }
    }

    onProgress({
      phase: 'done',
      message: `Done. Old data is still at ${currentPath} - remove it manually once you've verified everything works.`,
    });
    return { path: targetPath };
  });
}
