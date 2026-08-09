import { execFile } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import type { NmdClient } from '../nmd/index.js';
import type { StorageLocation } from '../settings/types.js';
import { runSudoMaybe } from '../system/procUtil.js';
import type { DockerClient } from './client.js';

const execFileAsync = promisify(execFile);
const DAEMON_JSON_PATH = '/etc/docker/daemon.json';

export interface StoragePathProgress {
  phase: string;
  message: string;
}

export interface DockerStorageInfo {
  // 'custom' covers a data-root this app didn't set (e.g. hand-edited outside boot/array convention)
  // — there's nothing to migrate *from* cleanly in that case beyond just picking a new target.
  mode: 'boot' | 'array' | 'custom';
  diskSlot: number | null;
  path: string;
}

/** Boot → today's real default; array disk N → a fixed subfolder, same convention as the LXC side
 *  (lxc/storagePath.ts) so the two are easy to reason about together. */
export function resolveDockerPath(location: StorageLocation): string {
  if (location.mode === 'boot') return '/var/lib/docker';
  if (location.diskSlot === null) throw new Error('diskSlot is required when mode is "array".');
  return `/mnt/disk${location.diskSlot}/system/docker`;
}

export async function getCurrentDockerStorage(docker: DockerClient): Promise<DockerStorageInfo> {
  const currentPath = await docker.getDataRoot();
  if (currentPath === '/var/lib/docker') return { mode: 'boot', diskSlot: null, path: currentPath };
  const match = currentPath.match(/^\/mnt\/disk(\d+)\/system\/docker$/);
  if (match) return { mode: 'array', diskSlot: Number(match[1]), path: currentPath };
  return { mode: 'custom', diskSlot: null, path: currentPath };
}

// One storage move at a time, system-wide — see lxc/storagePath.ts's identical lock for why.
let running = false;

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (running) throw new Error('A storage move is already running — wait for it to finish first.');
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
 * reports the new root. Containers without a restart policy simply stay stopped after this — normal
 * Docker behavior, not something this handles specially. Never deletes the old data.
 */
export async function migrateDockerStorage(
  target: StorageLocation,
  deps: { nmd: NmdClient; docker: DockerClient },
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
      throw new Error('A parity check or clear is in progress — refusing to move storage mid-operation.');
    }
    if (target.mode === 'array') {
      const disk = status.disks.find((d) => d.slot === target.diskSlot);
      if (!disk || disk.type !== 'data' || !disk.filesystem || disk.filesystem.mountpoint === 'unmounted') {
        throw new Error(`Disk ${target.diskSlot} isn't a mounted data disk.`);
      }
    }

    onProgress({ phase: 'checking', message: 'Checking available space…' });
    const sourceSize = await dirSizeBytes(currentPath);
    const targetMount = target.mode === 'array' ? `/mnt/disk${target.diskSlot}` : '/';
    const available = await freeSpaceBytes(targetMount);
    if (sourceSize > 0 && available < sourceSize * 1.1) {
      throw new Error(`Not enough free space at the target — needs about ${Math.ceil((sourceSize * 1.1) / 1024 / 1024)} MB.`);
    }

    onProgress({ phase: 'stopping', message: 'Stopping the Docker service…' });
    await runSudoMaybe('systemctl', ['stop', 'docker.socket', 'docker.service'], config.systemUseSudo);

    onProgress({ phase: 'copying', message: `Copying data to ${targetPath}…` });
    await runSudoMaybe('mkdir', ['-p', targetPath], config.systemUseSudo);
    if (await pathExists(currentPath)) {
      await runSudoMaybe('rsync', ['-a', `${currentPath}/`, `${targetPath}/`], config.systemUseSudo);
    }

    onProgress({ phase: 'reconfiguring', message: 'Updating Docker configuration…' });
    let daemonConfig: Record<string, unknown> = {};
    try {
      daemonConfig = JSON.parse(await readFile(DAEMON_JSON_PATH, 'utf8'));
    } catch {
      // missing, or unreadable without privilege — start fresh rather than blocking the move on a
      // pre-existing file this app doesn't own
    }
    daemonConfig['data-root'] = targetPath;
    const tmpPath = path.join(os.tmpdir(), `nonraid-daemon-${process.pid}.json`);
    await writeFile(tmpPath, JSON.stringify(daemonConfig, null, 2), 'utf8');
    await runSudoMaybe('mkdir', ['-p', path.dirname(DAEMON_JSON_PATH)], config.systemUseSudo);
    await runSudoMaybe('mv', [tmpPath, DAEMON_JSON_PATH], config.systemUseSudo);

    onProgress({ phase: 'starting', message: 'Starting the Docker service…' });
    await runSudoMaybe('systemctl', ['start', 'docker'], config.systemUseSudo);

    onProgress({ phase: 'verifying', message: 'Waiting for Docker to come back up…' });
    let verified = false;
    for (let i = 0; i < 15 && !verified; i++) {
      await sleep(1000);
      try {
        verified = (await deps.docker.getDataRoot()) === targetPath;
      } catch {
        // still starting — retry
      }
    }
    if (!verified) {
      throw new Error('Docker restarted but did not report the new storage location — check `docker info` and the service status manually.');
    }

    onProgress({
      phase: 'done',
      message: `Done. Old data is still at ${currentPath} — remove it manually once you've verified everything works.`,
    });
    return { path: targetPath };
  });
}
