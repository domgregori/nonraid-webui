import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import type { NmdClient } from '../nmd/index.js';
import type { SettingsStore } from '../settings/index.js';
import type { SmartService } from '../smart/service.js';
import type { SmartHealth } from '../smart/types.js';
import { getDeviceModel, isMounted, missingDevid, mountCache, resolveCacheDevicePaths } from './mount.js';
import type { CacheDeviceStatus, CacheHealth, CacheReplaceStatus, CacheStatus } from './types.js';

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

function emptyStatus(health: CacheHealth, enabled: boolean, fsUuid: string | null): CacheStatus {
  return { health, enabled, fsUuid, devices: [], usedBytes: null, totalBytes: null };
}

/**
 * Owns the cache mirror's lifecycle: one-time setup (mkfs.btrfs -m raid1 -d
 * raid1 across exactly two devices), mounting it at every backend startup
 * (this app has no fstab/systemd .mount unit anywhere — see mount.ts),
 * health reporting, and replacing a failed member via btrfs's own online
 * `replace` command. Deliberately has no ShareService dependency: callers
 * (cacheRouter) trigger shares.remountAll() themselves after a mutating call
 * succeeds, the same "service does the domain action, the route wires it to
 * the rest of the app" split /array/start already uses.
 */
export class CacheService {
  constructor(
    private nmd: NmdClient,
    private smart: SmartService,
    private settingsStore: SettingsStore,
  ) {}

  /**
   * Cheap yes/no check for RealShareApplier.branchPaths() — every share (re)mount calls this, so
   * unlike getStatus() (which also enriches with SMART/model for the UI) this skips everything but
   * "is the mirror enabled, fully present (both members — never a degraded one), and mounted."
   */
  async isActiveForShares(): Promise<boolean> {
    const settings = await this.settingsStore.get();
    if (!settings.cache.enabled || !settings.cache.fsUuid) return false;
    const present = await resolveCacheDevicePaths(settings.cache.fsUuid);
    if (present.length < 2) return false;
    return isMounted(config.cacheMountPoint);
  }

  async remountIfConfigured(): Promise<void> {
    const settings = await this.settingsStore.get();
    if (!settings.cache.fsUuid) return;
    try {
      await mountCache(settings.cache.fsUuid, config.cacheMountPoint);
    } catch (err) {
      console.error('Failed to mount cache pool at startup:', (err as Error).message);
    }
  }

  async getStatus(): Promise<CacheStatus> {
    const settings = await this.settingsStore.get();
    const fsUuid = settings.cache.fsUuid;
    if (!fsUuid) return emptyStatus('not-configured', settings.cache.enabled, null);

    const present = await resolveCacheDevicePaths(fsUuid);
    if (present.length === 0) return emptyStatus('unavailable', settings.cache.enabled, fsUuid);

    const missing = missingDevid(present);
    const smartHealths = await this.smart.getHealthStatuses(present.map((d) => d.path)).catch(() => ({}) as Record<string, SmartHealth | null>);
    const models = await Promise.all(present.map((d) => getDeviceModel(d.path)));

    const devices: CacheDeviceStatus[] = present.map((d, i) => ({
      devid: d.devid,
      path: d.path,
      model: models[i] ?? null,
      smartHealth: smartHealths[d.path] ?? null,
      missing: false,
    }));
    if (missing !== null) {
      devices.push({ devid: missing, path: null, model: null, smartHealth: null, missing: true });
    }
    devices.sort((a, b) => a.devid - b.devid);

    let usedBytes: number | null = null;
    let totalBytes: number | null = null;
    if (await isMounted(config.cacheMountPoint)) {
      try {
        const { stdout } = await run('df', ['-B1', '--output=used,size', config.cacheMountPoint], 10_000);
        const line = stdout.trim().split('\n').at(-1) ?? '';
        const [usedStr, totalStr] = line.trim().split(/\s+/);
        usedBytes = Number(usedStr);
        totalBytes = Number(totalStr);
        if (!Number.isFinite(usedBytes)) usedBytes = null;
        if (!Number.isFinite(totalBytes)) totalBytes = null;
      } catch {
        // leave both null — a stale/failed df shouldn't hide health/device info
      }
    }

    return {
      health: missing !== null ? 'degraded' : 'healthy',
      enabled: settings.cache.enabled,
      fsUuid,
      devices,
      usedBytes,
      totalBytes,
    };
  }

  async setup(deviceA: string, deviceB: string): Promise<void> {
    const current = await this.settingsStore.get();
    if (current.cache.fsUuid) throw new HttpError(409, 'Cache pool is already set up.');
    if (deviceA === deviceB) throw new HttpError(400, 'Pick two different devices for the mirror.');

    // Never trust client-supplied paths directly — revalidate against a fresh
    // scan right before acting, same discipline every other disk-mutating
    // route in this app follows (see routes/disks.ts).
    const available = await this.nmd.listAvailableDevices();
    for (const dev of [deviceA, deviceB]) {
      const match = available.find((d) => d.device === dev);
      if (!match) throw new HttpError(400, `${dev} is not a currently available device.`);
      if (match.locked) throw new HttpError(409, `${dev} appears to be in use by another process — refusing to touch it.`);
    }

    // No -f: mkfs.btrfs refuses on its own if either device already carries a
    // recognized filesystem/RAID signature — the same real safety backstop
    // formatDisk() relies on for array disks, on top of the fresh-scan check
    // above (listAvailableDevices() already excludes a disk with any mounted
    // partition, but not one with an unmounted-but-real filesystem on it).
    await run('mkfs.btrfs', ['-m', 'raid1', '-d', 'raid1', deviceA, deviceB], config.cacheMkfsTimeoutMs);

    const { stdout } = await run('blkid', ['-s', 'UUID', '-o', 'value', deviceA], 10_000);
    const fsUuid = stdout.trim();
    if (!fsUuid) throw new Error("Could not determine the new filesystem's UUID after mkfs.");

    await mountCache(fsUuid, config.cacheMountPoint);
    await this.settingsStore.update({ cache: { fsUuid, enabled: false } });
  }

  async replaceDevice(newDevice: string): Promise<void> {
    const settings = await this.settingsStore.get();
    if (!settings.cache.fsUuid) throw new HttpError(400, 'Cache pool is not set up.');

    const status = await this.getStatus();
    if (status.health !== 'degraded') throw new HttpError(409, 'Cache pool is not degraded — nothing to replace.');

    const available = await this.nmd.listAvailableDevices();
    const match = available.find((d) => d.device === newDevice);
    if (!match) throw new HttpError(400, `${newDevice} is not a currently available device.`);
    if (match.locked) throw new HttpError(409, `${newDevice} appears to be in use by another process — refusing to touch it.`);

    const missingDevice = status.devices.find((d) => d.missing);
    if (!missingDevice) throw new HttpError(409, 'No missing mirror member found to replace.');

    const { stdout, stderr } = await run(
      'btrfs',
      ['replace', 'start', String(missingDevice.devid), newDevice, config.cacheMountPoint],
      30_000,
    ).catch((err) => {
      throw new HttpError(502, (err as Error).message);
    });
    if (/ERROR/i.test(stderr) || /ERROR/i.test(stdout)) throw new HttpError(502, stderr.trim() || stdout.trim());
  }

  async replaceStatus(): Promise<CacheReplaceStatus> {
    const settings = await this.settingsStore.get();
    if (!settings.cache.fsUuid) return { running: false, progressPercent: null, message: null };

    const { stdout } = await run('btrfs', ['replace', 'status', config.cacheMountPoint], 10_000).catch(() => ({ stdout: '' }));
    const text = stdout.trim();
    if (!text || /never started|no replace/i.test(text)) return { running: false, progressPercent: null, message: null };
    if (/finished/i.test(text)) return { running: false, progressPercent: 100, message: text };

    const m = text.match(/(\d+(?:\.\d+)?)%\s+done/);
    return { running: true, progressPercent: m ? Number(m[1]) : null, message: text };
  }
}
