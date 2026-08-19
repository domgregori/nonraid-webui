import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);

// sysconf(_SC_CLK_TCK) - 100 on effectively every Linux target this runs on
// (x86/arm, glibc and musl); there is no portable way to read it from Node
// without a native addon, so this is a documented assumption rather than a
// detected value.
const CLOCK_TICKS_PER_SEC = 100;

interface ProcSnapshot {
  totalTicks: number;
  atMs: number;
}

export interface LxcStatSample {
  cpuPercent: number;
  memUsedBytes: number;
  ips: string[];
}

async function listActiveNames(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('lxc-ls', ['-P', config.lxcDefaultPath, '--active'], { timeout: config.lxcTimeoutMs });
    return stdout.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function getPid(name: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('lxc-info', ['-P', config.lxcDefaultPath, '-n', name, '-p', '-H'], {
      timeout: config.lxcTimeoutMs,
    });
    const pid = Number(stdout.trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function getIps(name: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('lxc-info', ['-P', config.lxcDefaultPath, '-n', name, '-i', '-H'], {
      timeout: config.lxcTimeoutMs,
    });
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** `utime`+`stime` (fields 14/15, i.e. index 11/12 counting from the field
 * right after the comm's closing paren) of the container's init process. comm
 * itself may contain spaces or parens, so split on the LAST ')', not the first. */
async function readProcTotalTicks(pid: number): Promise<number | null> {
  try {
    const raw = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    const afterComm = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
    const utime = Number(afterComm[11]);
    const stime = Number(afterComm[12]);
    if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
    return utime + stime;
  } catch {
    return null;
  }
}

async function readRssBytes(pid: number): Promise<number> {
  try {
    const raw = await fs.readFile(`/proc/${pid}/status`, 'utf8');
    const match = raw.match(/^VmRSS:\s+(\d+)\s+kB/m);
    return match ? Number(match[1]) * 1024 : 0;
  } catch {
    return 0;
  }
}

/**
 * Poll-and-cache worker for per-container CPU%/memory/IPs, same shape as
 * system/service.ts's SystemStatsService - not the reference plugin's own
 * `/tmp/lxc/containers/<name>` INI files, which are written by a separate
 * PHP-plugin-specific worker script this backend has no equivalent of.
 *
 * `lxc-info` has no built-in resource-usage stats beyond state/pid/ips, so
 * CPU/memory are derived from /proc/<pid>/stat and /proc/<pid>/status for
 * the container's init process. This undercounts CPU for a container whose
 * real workload runs in child processes that get their own host PIDs
 * (namespaced, but still visible and separately accounted for on the host)
 * - reading the actual cgroup accounting files would be exact, but their
 * path varies by cgroup v1 vs v2 and by distro mount layout in a way
 * /proc/<pid> doesn't. Accepted approximation for Phase 1.
 */
export class LxcStatsPoller {
  private prev = new Map<string, ProcSnapshot>();
  private cache = new Map<string, LxcStatSample>();
  private timer: NodeJS.Timeout;

  constructor(intervalMs: number = config.lxcStatsIntervalMs) {
    this.timer = setInterval(() => {
      this.tick().catch(() => {});
    }, intervalMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    const names = await listActiveNames();
    const seen = new Set(names);
    for (const key of [...this.cache.keys()]) {
      if (!seen.has(key)) this.cache.delete(key);
    }
    for (const key of [...this.prev.keys()]) {
      if (!seen.has(key)) this.prev.delete(key);
    }

    await Promise.all(
      names.map(async (name) => {
        const pid = await getPid(name);
        if (!pid) return;
        const [totalTicks, memUsedBytes, ips] = await Promise.all([readProcTotalTicks(pid), readRssBytes(pid), getIps(name)]);

        let cpuPercent = 0;
        const nowMs = Date.now();
        if (totalTicks !== null) {
          const prev = this.prev.get(name);
          if (prev) {
            const tickDelta = totalTicks - prev.totalTicks;
            const msDelta = nowMs - prev.atMs;
            if (msDelta > 0) cpuPercent = Math.max(0, ((tickDelta / CLOCK_TICKS_PER_SEC) * 1000 * 100) / msDelta);
          }
          this.prev.set(name, { totalTicks, atMs: nowMs });
        }

        this.cache.set(name, { cpuPercent: Math.round(cpuPercent * 10) / 10, memUsedBytes, ips });
      }),
    );
  }

  get(name: string): LxcStatSample | null {
    return this.cache.get(name) ?? null;
  }
}
