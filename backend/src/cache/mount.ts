import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);

async function run(bin: string, args: string[], timeoutMs = config.cacheTimeoutMs): Promise<{ stdout: string; stderr: string }> {
  const useSudo = config.cacheUseSudo;
  try {
    return await execFileAsync(useSudo ? 'sudo' : bin, useSudo ? [bin, ...args] : args, {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    throw new Error(e.stderr?.trim() || e.stdout?.trim() || e.message);
  }
}

export interface ResolvedCacheDevice {
  devid: number;
  path: string;
}

/**
 * The mirror is always created from exactly two devices (see cache/service.ts's
 * setup() — the feature's whole premise is "a mirrored pair", never more or
 * fewer), so `btrfs filesystem show` not listing one of devid 1/2 unambiguously
 * identifies which one is missing without needing the mounted-only `btrfs
 * device stats`/`device usage` output to spell it out. `btrfs device scan` is
 * run first so a device that appeared since the last scan (e.g. right after
 * boot, before udev's own scan has necessarily settled) is picked up.
 */
export async function resolveCacheDevicePaths(fsUuid: string): Promise<ResolvedCacheDevice[]> {
  await run('btrfs', ['device', 'scan']).catch(() => {}); // best-effort — a missing device is a valid outcome, not a failure
  const { stdout } = await run('btrfs', ['filesystem', 'show', fsUuid]).catch(() => ({ stdout: '' }));
  const devices: ResolvedCacheDevice[] = [];
  for (const line of stdout.split('\n')) {
    const m = line.match(/devid\s+(\d+)\s+size\s+\S+\s+used\s+\S+\s+path\s+(\S+)/);
    if (m) devices.push({ devid: Number(m[1]), path: m[2]! });
  }
  return devices;
}

export function missingDevid(present: ResolvedCacheDevice[]): number | null {
  const presentIds = new Set(present.map((d) => d.devid));
  for (const id of [1, 2]) {
    if (!presentIds.has(id)) return id;
  }
  return null;
}

export async function isMounted(mountPoint: string): Promise<boolean> {
  try {
    await run('mountpoint', ['-q', mountPoint], 5_000);
    return true;
  } catch {
    return false;
  }
}

/** Same udevadm property lookup scanDevice() (nmd/realClient.ts) uses for AvailableDevice.model — duplicated in miniature here since a cache member is no longer an "available" device once claimed, so it never appears in listAvailableDevices() again for CacheService.getStatus() to read a cached model off of. */
export async function getDeviceModel(devicePath: string): Promise<string | null> {
  try {
    const { stdout } = await run('udevadm', ['info', '--query=property', `--name=${devicePath}`], 5_000);
    const line = stdout.split('\n').find((l) => l.startsWith('ID_MODEL='));
    return line ? line.slice('ID_MODEL='.length).trim().replace(/_/g, ' ') || null : null;
  } catch {
    return null;
  }
}

/** Raw byte size of a still-mounted mirror member — used by CacheService.replaceDevice() to enforce
 *  btrfs's own same-size-or-larger requirement for a replacement, up front with a clear message
 *  rather than letting `btrfs replace start` fail deep into the operation. */
export async function getDeviceSizeBytes(devicePath: string): Promise<number | null> {
  try {
    const { stdout } = await run('lsblk', ['-b', '-n', '-d', '-o', 'SIZE', devicePath], 5_000);
    const bytes = Number(stdout.trim());
    return Number.isFinite(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * Idempotent — safe to call at every backend startup regardless of whether
 * the mirror is already mounted (this app has no fstab/systemd .mount unit
 * anywhere, see the plan's scope decisions; every mount is re-established
 * imperatively like this, the same as ShareService.remountAll()). Mounts
 * degraded automatically when only one member is present, rather than
 * failing outright — a missing mirror half shouldn't take the whole cache
 * offline, see CacheService.getStatus()'s health reporting for the visible
 * degraded state this produces.
 */
export async function mountCache(fsUuid: string, mountPoint: string): Promise<{ mounted: boolean; degraded: boolean }> {
  if (await isMounted(mountPoint)) {
    const present = await resolveCacheDevicePaths(fsUuid);
    return { mounted: true, degraded: present.length < 2 };
  }

  const present = await resolveCacheDevicePaths(fsUuid);
  if (present.length === 0) return { mounted: false, degraded: false };

  await run('mkdir', ['-p', mountPoint], 5_000);
  const devicePath = present[0]!.path;
  try {
    await run('mount', [devicePath, mountPoint], 30_000);
    return { mounted: true, degraded: false };
  } catch {
    if (present.length < 2) {
      await run('mount', ['-o', 'degraded', devicePath, mountPoint], 30_000);
      return { mounted: true, degraded: true };
    }
    throw new Error(`Failed to mount cache pool at ${mountPoint}.`);
  }
}
