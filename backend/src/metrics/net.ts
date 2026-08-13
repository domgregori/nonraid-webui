import { readFile } from 'node:fs/promises';

export interface NetTotals {
  rxBytes: number;
  txBytes: number;
}

/**
 * Sums bytes across all non-virtual interfaces from /proc/net/dev - Linux-only,
 * which matches this project's deployment target (the NAS host itself, or the
 * dev VM), same caveat SystemStatsService documents for os.cpus()/totalmem().
 * Excludes loopback and container-bridge/veth interfaces so container traffic
 * isn't double-counted against the host's own network usage.
 */
export async function readNetTotals(): Promise<NetTotals | null> {
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
    return null; // not on Linux, or /proc unavailable
  }
}

export interface NetRate {
  rxKbS: number;
  txKbS: number;
}

/**
 * Turns successive readNetTotals() snapshots into a rate - shared shape between the 60s history
 * sampler (sampler.ts) and the 3s live-poll route (routes/system.ts's /system/net-live), each
 * holding their own independent tracker instance so one's cadence never perturbs the other's
 * delta math.
 */
export class NetRateTracker {
  private prev: (NetTotals & { ts: number }) | null = null;

  /** Null on the first call (nothing to diff against yet) or when the counters reset (interface
   *  replaced/reset - a negative delta), same as sampler.ts always treated it. */
  async sample(): Promise<NetRate | null> {
    const now = Date.now();
    const totals = await readNetTotals();
    if (!totals) return null;

    const prev = this.prev;
    this.prev = { ...totals, ts: now };
    if (!prev) return null;

    const dtSec = (now - prev.ts) / 1000;
    const dRx = totals.rxBytes - prev.rxBytes;
    const dTx = totals.txBytes - prev.txBytes;
    if (dtSec <= 0 || dRx < 0 || dTx < 0) return null;

    return { rxKbS: dRx / 1024 / dtSec, txKbS: dTx / 1024 / dtSec };
  }
}
