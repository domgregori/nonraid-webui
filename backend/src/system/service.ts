import { execFile, execFileSync, execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { config } from '../config.js';
import type { SmartService } from '../smart/service.js';
import { VERSION } from '../version.js';
import { readCpuTempCelsius } from './cpuTemp.js';
import type { BootDiskInfo, NetworkInterfaceInfo, SystemStats } from './types.js';

// Virtual bridges created by this app's own Docker/LXC support — not
// something an admin cares about seeing alongside their real network
// interfaces. `os.networkInterfaces()` already excludes loopback addresses
// via their own `internal: true` flag, so 'lo' needs no special-casing here.
const EXCLUDED_INTERFACES = new Set(['docker0', 'lxcbr0']);

/** Built entirely from Node's own os.networkInterfaces() — no subprocess, no sudo, and
 *  deliberately read-only (see the networkInterfaces doc comment on SystemStats). */
function getNetworkInterfaces(): NetworkInterfaceInfo[] {
  const all = os.networkInterfaces();
  const result: NetworkInterfaceInfo[] = [];
  for (const [name, addrs] of Object.entries(all)) {
    if (!addrs || EXCLUDED_INTERFACES.has(name)) continue;
    const real = addrs.filter((a) => !a.internal);
    if (real.length === 0) continue;
    const mac = real.find((a) => a.mac && a.mac !== '00:00:00:00:00:00')?.mac ?? null;
    result.push({
      name,
      ipv4: real.filter((a) => a.family === 'IPv4').map((a) => a.address),
      ipv6: real.filter((a) => a.family === 'IPv6').map((a) => a.address),
      mac,
    });
  }
  return result;
}

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const BOOT_DISK_REFRESH_MS = 60_000;

function readBuildVersion(): string | null {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: THIS_DIR, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null; // not a git checkout (e.g. a packaged deployment with no .git) — fine, just omit it
  }
}

interface BootDiskIdentity {
  device: string;
  model: string | null;
}

/**
 * Resolves the physical disk backing `/` — not part of the array, so nothing
 * else in this app already knows this. Run once at construction (this
 * identity never changes at runtime), same pattern as readBuildVersion()
 * above. Never throws — a packaged/unusual environment (no lsblk, root on
 * something exotic) just means no boot disk info, not a broken /api/system.
 */
function resolveBootDiskIdentity(): BootDiskIdentity | null {
  try {
    // argv arrays only, never shell strings — same discipline as every other
    // command execution in this codebase (see e.g. nmd/realClient.ts).
    const partition = execFileSync('df', ['-k', '--output=source', '/'], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
      .split('\n')
      .at(-1)
      ?.trim();
    if (!partition) return null;

    const pkname = execFileSync('lsblk', ['-n', '-p', '-o', 'PKNAME', partition], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    const device = pkname || partition; // fall back to the partition itself if PKNAME resolution fails

    const model = execFileSync('lsblk', ['-n', '-d', '-o', 'MODEL', device], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();

    return { device, model: model || null };
  } catch {
    return null;
  }
}

interface CpuSnapshot {
  idle: number;
  total: number;
}

function cpuSnapshot(): CpuSnapshot {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

/**
 * Node's `os` module always works, needs no external binary/daemon and no
 * privilege, so there's nothing to fail to detect. CPU% needs two samples
 * over time (a single snapshot is just cumulative counters since boot), so
 * this samples in the background on an interval and serves the latest
 * computed value, same "don't add latency to every request" reasoning as
 * SmartService's caching.
 *
 * Caveat: os.cpus()/totalmem()/freemem() are container-oblivious — inside a
 * Docker container they'd report the HOST's stats, not the container's own
 * cgroup limits. Not an issue for this project's actual deployment target
 * (running directly on the NAS host or in the dev VM, both of which have
 * their own real kernel), only relevant if this ever runs inside a container.
 */
export class SystemStatsService {
  private last: CpuSnapshot = cpuSnapshot();
  private cpuPercent = 0;
  private timer: NodeJS.Timeout;
  private readonly buildVersion = readBuildVersion();
  private readonly bootDiskIdentity = resolveBootDiskIdentity();
  private bootDisk: BootDiskInfo | null = null;
  private bootDiskTimer: NodeJS.Timeout | null = null;

  constructor(
    private smart: SmartService,
    intervalMs: number = config.systemStatsIntervalMs,
  ) {
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref();

    if (this.bootDiskIdentity) {
      this.refreshBootDisk(); // fire-and-forget — getStats() serves null until this resolves
      this.bootDiskTimer = setInterval(() => this.refreshBootDisk(), BOOT_DISK_REFRESH_MS);
      this.bootDiskTimer.unref();
    }
  }

  private tick(): void {
    const snap = cpuSnapshot();
    const idleDelta = snap.idle - this.last.idle;
    const totalDelta = snap.total - this.last.total;
    this.cpuPercent = totalDelta > 0 ? Math.max(0, Math.min(100, 100 * (1 - idleDelta / totalDelta))) : 0;
    this.last = snap;
  }

  /**
   * Capacity + temperature change over time, unlike device/model identity —
   * refreshed on its own slower cadence (not tied to the CPU-sampling
   * interval), same "don't hammer external tools on every poll" reasoning as
   * SmartService's own TTL cache. Temperature is read through SmartService
   * itself rather than a second smartctl call site, reusing its caching.
   */
  private async refreshBootDisk(): Promise<void> {
    const identity = this.bootDiskIdentity;
    if (!identity) return;
    try {
      const { stdout } = await execFileAsync('df', ['-k', '--output=source,fstype,used,size', '/']);
      const lastLine = stdout.trim().split('\n').at(-1) ?? '';
      const [source, fstype, usedKbStr, sizeKbStr] = lastLine.trim().split(/\s+/);
      const usedKb = Number(usedKbStr);
      const sizeKb = Number(sizeKbStr);

      const temps = await this.smart.getTemperatures([identity.device]);

      let uuid: string | null = null;
      if (source) {
        try {
          const { stdout: uuidOut } = await execFileAsync('lsblk', ['-n', '-d', '-o', 'UUID', source]);
          uuid = uuidOut.trim() || null;
        } catch {
          uuid = null;
        }
      }

      this.bootDisk = {
        device: identity.device,
        filesystem: fstype || null,
        usedBytes: Number.isFinite(usedKb) ? usedKb * 1024 : null,
        totalBytes: Number.isFinite(sizeKb) ? sizeKb * 1024 : null,
        model: identity.model,
        tempCelsius: temps[identity.device] ?? null,
        uuid,
      };
    } catch {
      // leave the last-known snapshot in place (or null, on the first-ever
      // refresh) rather than erroring the whole /api/system response
    }
  }

  /** Parent whole-disk device backing `/` (e.g. `/dev/sda`, not a partition) — used by the boot
   *  disk backup routes. `null` when detection failed, same as bootDisk in getStats(). */
  getBootDiskDevice(): string | null {
    return this.bootDiskIdentity?.device ?? null;
  }

  getStats(): SystemStats {
    const memTotalBytes = os.totalmem();
    const memFreeBytes = os.freemem();
    return {
      hostname: os.hostname(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      uptimeSeconds: os.uptime(),
      cpuPercent: Math.round(this.cpuPercent * 10) / 10,
      cpuTempCelsius: readCpuTempCelsius(),
      memUsedBytes: memTotalBytes - memFreeBytes,
      memTotalBytes,
      buildVersion: this.buildVersion,
      version: VERSION,
      bootDisk: this.bootDisk,
      networkInterfaces: getNetworkInterfaces(),
    };
  }
}
