import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { config } from '../config.js';
import type { NmdClient } from '../nmd/index.js';
import type { SettingsStore } from '../settings/index.js';
import type { StorageLocation } from '../settings/types.js';
import { runSudoMaybe } from '../system/procUtil.js';
import type { LxcClient } from './client.js';

const execFileAsync = promisify(execFile);

export interface StoragePathProgress {
  phase: string;
  message: string;
}

/** Boot → today's real default; array disk N → a fixed subfolder, same convention as the Docker
 *  side (docker/storagePath.ts) so the two are easy to reason about together. */
export function resolveLxcPath(location: StorageLocation): string {
  if (location.mode === 'boot') return '/var/lib/lxc';
  if (location.diskSlot === null) throw new Error('diskSlot is required when mode is "array".');
  return `/mnt/disk${location.diskSlot}/system/lxc`;
}

// One storage move at a time, system-wide — concurrent moves (or a move racing a benchmark's own
// heavy I/O) would contend for bandwidth and leave things in a confusing half-done state.
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

export async function getCurrentLxcStorage(settingsStore: SettingsStore): Promise<StorageLocation & { path: string }> {
  const settings = await settingsStore.get();
  return { ...settings.lxcStorage, path: resolveLxcPath(settings.lxcStorage) };
}

/**
 * Stops any running containers, rsyncs the container directory tree to the new location, switches
 * config.lxcDefaultPath (read fresh by every lxc-* call in realClient.ts — no restart needed) and
 * persists the choice, then restarts whatever was running. Never deletes the old data — leaves it
 * in place so a failed verification doesn't mean lost containers, at the cost of temporary double
 * disk usage until the admin removes it by hand.
 */
export async function migrateLxcStorage(
  target: StorageLocation,
  deps: { nmd: NmdClient; lxc: LxcClient; settingsStore: SettingsStore },
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

    onProgress({ phase: 'stopping', message: 'Stopping running LXC containers…' });
    const containers = await deps.lxc.listContainers();
    const runningNames = containers.filter((c) => c.state === 'running').map((c) => c.name);
    for (const name of runningNames) {
      await deps.lxc.stopContainer(name);
    }

    onProgress({ phase: 'copying', message: `Copying data to ${targetPath}…` });
    await runSudoMaybe('mkdir', ['-p', targetPath], config.lxcUseSudo);
    if (await pathExists(currentPath)) {
      await runSudoMaybe('rsync', ['-a', `${currentPath}/`, `${targetPath}/`], config.lxcUseSudo);
    }

    onProgress({ phase: 'switching', message: 'Switching to the new location…' });
    config.lxcDefaultPath = targetPath;
    await deps.settingsStore.update({ lxcStorage: target });

    if (runningNames.length > 0) {
      onProgress({ phase: 'restarting', message: 'Restarting containers…' });
      for (const name of runningNames) {
        await deps.lxc.startContainer(name).catch(() => {});
      }
    }

    onProgress({
      phase: 'done',
      message: `Done. Old data is still at ${currentPath} — remove it manually once you've verified everything works.`,
    });
    return { path: targetPath };
  });
}
