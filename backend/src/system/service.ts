import os from 'node:os';
import { config } from '../config.js';
import type { SystemStats } from './types.js';

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
 * No real/mock split here, unlike nmd/docker/smart/shares — Node's `os` module
 * always works, needs no external binary/daemon and no privilege, so there's
 * nothing to fail to detect. CPU% needs two samples over time (a single
 * snapshot is just cumulative counters since boot), so this samples in the
 * background on an interval and serves the latest computed value, same
 * "don't add latency to every request" reasoning as SmartService's caching.
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

  constructor(intervalMs: number = config.systemStatsIntervalMs) {
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref();
  }

  private tick(): void {
    const snap = cpuSnapshot();
    const idleDelta = snap.idle - this.last.idle;
    const totalDelta = snap.total - this.last.total;
    this.cpuPercent = totalDelta > 0 ? Math.max(0, Math.min(100, 100 * (1 - idleDelta / totalDelta))) : 0;
    this.last = snap;
  }

  getStats(): SystemStats {
    const memTotalBytes = os.totalmem();
    const memFreeBytes = os.freemem();
    return {
      hostname: os.hostname(),
      uptimeSeconds: os.uptime(),
      cpuPercent: Math.round(this.cpuPercent * 10) / 10,
      memUsedBytes: memTotalBytes - memFreeBytes,
      memTotalBytes,
    };
  }
}
