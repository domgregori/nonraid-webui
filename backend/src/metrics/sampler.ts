import { readFile } from 'node:fs/promises';
import { config } from '../config.js';
import type { NmdClient } from '../nmd/index.js';
import type { SmartService } from '../smart/index.js';
import type { SystemStatsService } from '../system/service.js';
import { MetricsService } from './service.js';
import type { MetricName } from './types.js';

// The driver counts I/O in 8-sector units — see calculate_disk_io_rates() in
// tools/nmdctl (the main nonraid repo): "Driver writes and reads are in
// 8-sector units = 4kB". nmdctl's own JSON output never computes a rate from
// this (that math is text-monitor-only, not part of `status -o json`), so
// the sampler has to diff successive cumulative counts itself.
const BYTES_PER_IO_UNIT = 4096;

// Prune is a full-ish scan (indexed on ts, but still O(rows below cutoff)) —
// running it every tick would be wasteful at a 60s sample interval, so only
// do it once an hour's worth of ticks have passed.
const PRUNE_EVERY_N_TICKS = 60;

interface DiskIoPrev {
  reads: number;
  writes: number;
  ts: number;
}

interface NetTotals {
  rxBytes: number;
  txBytes: number;
}

/**
 * Sums bytes across all non-virtual interfaces from /proc/net/dev — Linux-only,
 * which matches this project's deployment target (the NAS host itself, or the
 * dev VM), same caveat SystemStatsService documents for os.cpus()/totalmem().
 * Excludes loopback and container-bridge/veth interfaces so container traffic
 * isn't double-counted against the host's own network usage.
 */
async function readNetTotals(): Promise<NetTotals | null> {
  try {
    const text = await readFile('/proc/net/dev', 'utf8');
    let rxBytes = 0;
    let txBytes = 0;
    for (const line of text.split('\n').slice(2)) {
      const [ifacePart, statsPart] = line.split(':');
      if (!ifacePart || !statsPart) continue;
      const iface = ifacePart.trim();
      if (iface === 'lo' || iface.startsWith('veth') || iface.startsWith('docker') || iface.startsWith('br-')) continue;
      const fields = statsPart.trim().split(/\s+/).map(Number);
      rxBytes += fields[0] ?? 0;
      txBytes += fields[8] ?? 0;
    }
    return { rxBytes, txBytes };
  } catch {
    return null; // not on Linux, or /proc unavailable — best-effort, cpu/mem/disk metrics still work
  }
}

export class MetricsSampler {
  private timer: NodeJS.Timeout | null = null;
  private diskIoPrev = new Map<number, DiskIoPrev>();
  private netPrev: (NetTotals & { ts: number }) | null = null;
  private tickCount = 0;

  constructor(
    private metrics: MetricsService,
    private system: SystemStatsService,
    private nmd: NmdClient,
    private smart: SmartService,
    private intervalMs: number = config.metricsSampleIntervalMs,
  ) {}

  start(): void {
    this.tick().catch((err) => console.error('Metrics sampler tick failed:', (err as Error).message));
    this.timer = setInterval(() => {
      this.tick().catch((err) => console.error('Metrics sampler tick failed:', (err as Error).message));
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    const samples: { metric: MetricName; key: string; value: number }[] = [];

    const stats = this.system.getStats();
    samples.push({ metric: 'cpu_percent', key: 'total', value: stats.cpuPercent });
    samples.push({ metric: 'mem_used_bytes', key: 'total', value: stats.memUsedBytes });

    const net = await readNetTotals();
    if (net) {
      if (this.netPrev) {
        const dtSec = (now - this.netPrev.ts) / 1000;
        const dRx = net.rxBytes - this.netPrev.rxBytes;
        const dTx = net.txBytes - this.netPrev.txBytes;
        // Negative delta means the counter reset (interface reset/replaced) — skip this tick rather than record a bogus negative rate.
        if (dtSec > 0 && dRx >= 0) samples.push({ metric: 'net_rx_kb_s', key: 'total', value: dRx / 1024 / dtSec });
        if (dtSec > 0 && dTx >= 0) samples.push({ metric: 'net_tx_kb_s', key: 'total', value: dTx / 1024 / dtSec });
      }
      this.netPrev = { ...net, ts: now };
    }

    try {
      const status = await this.nmd.getStatus();
      const assigned = status.disks.filter((d) => d.device && d.device !== 'none');
      const temps = await this.smart.getTemperatures(assigned.map((d) => d.device));

      for (const disk of assigned) {
        const key = String(disk.slot);

        const temp = temps[disk.device];
        if (typeof temp === 'number') samples.push({ metric: 'disk_temp_c', key, value: temp });

        if (disk.filesystem?.usage) {
          const pct = Number.parseFloat(disk.filesystem.usage);
          if (Number.isFinite(pct)) samples.push({ metric: 'disk_usage_pct', key, value: pct });
        }

        const prev = this.diskIoPrev.get(disk.slot);
        if (prev) {
          const dtSec = (now - prev.ts) / 1000;
          const dReads = disk.reads - prev.reads;
          const dWrites = disk.writes - prev.writes;
          if (dtSec > 0 && dReads >= 0) samples.push({ metric: 'disk_read_kb_s', key, value: (dReads * BYTES_PER_IO_UNIT) / 1024 / dtSec });
          if (dtSec > 0 && dWrites >= 0) samples.push({ metric: 'disk_write_kb_s', key, value: (dWrites * BYTES_PER_IO_UNIT) / 1024 / dtSec });
        }
        this.diskIoPrev.set(disk.slot, { reads: disk.reads, writes: disk.writes, ts: now });
      }
    } catch {
      // Array not started, or the driver call failed — skip disk metrics this tick; cpu/mem/net are still recorded above.
    }

    this.metrics.recordBatch(samples, now);

    this.tickCount += 1;
    if (this.tickCount % PRUNE_EVERY_N_TICKS === 0) this.metrics.prune();
  }
}
