import { open, unlink } from 'node:fs/promises';
import path from 'node:path';

export interface BenchmarkSample {
  elapsedSeconds: number;
  mbPerSecond: number;
}

export interface BenchmarkResult {
  mbPerSecond: number;
  elapsedSeconds: number;
  sizeMb: number;
  samples: BenchmarkSample[];
}

// A fixed time window (rather than a fixed byte count) bounds worst-case wait time regardless of
// how slow the target disk is — confirmed live: the boot disk's USB stick took ~55 real seconds to
// write a fixed 512MB, which a duration cap turns into a predictable ~4s regardless of device speed.
// MAX_MB is a generous safety ceiling for the opposite case (an unexpectedly fast device).
const BENCHMARK_DURATION_MS = 4000;
const SAMPLE_INTERVAL_MS = 250;
const MAX_MB = 2048;
const READ_CHUNK_BYTES = 4 * 1024 * 1024;
const WRITE_CHUNK_BYTES = 1024 * 1024;
const BENCHMARK_FILENAME = '.nonraid-benchmark-tmp';

// NmdDisk.device (from nmdctl status) is a bare name like "sdd4" — same idiom as
// hdparm.ts's own devicePath().
function devicePath(device: string): string {
  return device.startsWith('/dev/') ? device : `/dev/${device}`;
}

// Only one benchmark at a time, system-wide: concurrent reads/writes would contend for I/O and
// produce misleading numbers for both.
let running = false;

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (running) throw new Error('A benchmark is already running — wait for it to finish first.');
  running = true;
  try {
    return await fn();
  } finally {
    running = false;
  }
}

/**
 * Reads sequentially from the start of the raw device for up to BENCHMARK_DURATION_MS (or MAX_MB,
 * whichever comes first), sampling instantaneous throughput every SAMPLE_INTERVAL_MS so callers can
 * chart speed over time, not just a single aggregate number. Deliberately a plain buffered read (no
 * O_DIRECT) — same "reflects real OS+drive behavior" philosophy the previous hdparm -t based
 * implementation used, just without needing an external binary now that this needs per-interval
 * samples hdparm has no way to report.
 */
export async function benchmarkRead(device: string): Promise<BenchmarkResult> {
  return withLock(async () => {
    const target = devicePath(device);
    const chunk = Buffer.alloc(READ_CHUNK_BYTES);
    const samples: BenchmarkSample[] = [];
    const start = Date.now();
    let lastSampleTime = start;
    let bytesSinceLastSample = 0;
    let totalBytes = 0;
    let handle;
    try {
      handle = await open(target, 'r');
      while (Date.now() - start < BENCHMARK_DURATION_MS && totalBytes < MAX_MB * 1024 * 1024) {
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
        if (bytesRead === 0) break; // hit end of device — shouldn't happen within this window on any real disk
        totalBytes += bytesRead;
        bytesSinceLastSample += bytesRead;
        const now = Date.now();
        if (now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
          samples.push({
            elapsedSeconds: (now - start) / 1000,
            mbPerSecond: bytesSinceLastSample / 1024 / 1024 / ((now - lastSampleTime) / 1000),
          });
          lastSampleTime = now;
          bytesSinceLastSample = 0;
        }
      }
    } finally {
      await handle?.close();
    }
    const elapsedSeconds = (Date.now() - start) / 1000;
    const sizeMb = totalBytes / 1024 / 1024;
    return { mbPerSecond: sizeMb / elapsedSeconds, elapsedSeconds, sizeMb, samples };
  });
}

/**
 * Writes a throwaway file through the disk's own existing mount, deletes it when done — never
 * touches raw sectors, so this is safe on any mounted disk including an active array member. Calls
 * handle.datasync() after every chunk, not just periodically — confirmed live this is necessary,
 * not just extra-cautious: a buffered write() call returns as soon as the data hits the page cache,
 * which for a burst of chunks is fast enough that write-behind buffering silently absorbed over
 * 1GB into RAM before the first periodic sync ever ran, then blocked for 7+ real seconds flushing
 * that whole backlog in one call — blowing straight through the duration cap and collapsing what
 * should have been ~16 samples into 1. Syncing every chunk means every loop iteration takes real,
 * bounded device time, so the elapsed-time check actually holds and sampling stays meaningful. Plain
 * fs, no subprocess: the backend already runs as root on the real deployment (confirmed live — the
 * systemd unit has no User=), so no sudo wrapping is needed for a normal file write.
 */
export async function benchmarkWrite(mountpoint: string): Promise<BenchmarkResult> {
  return withLock(async () => {
    const target = path.join(mountpoint, BENCHMARK_FILENAME);
    const chunk = Buffer.alloc(WRITE_CHUNK_BYTES);
    const samples: BenchmarkSample[] = [];
    const start = Date.now();
    let lastSampleTime = start;
    let bytesSinceLastSample = 0;
    let totalBytes = 0;
    let handle;
    try {
      handle = await open(target, 'w');
      while (Date.now() - start < BENCHMARK_DURATION_MS && totalBytes < MAX_MB * 1024 * 1024) {
        await handle.write(chunk);
        await handle.datasync();
        totalBytes += chunk.length;
        bytesSinceLastSample += chunk.length;
        const now = Date.now();
        if (now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
          samples.push({
            elapsedSeconds: (now - start) / 1000,
            mbPerSecond: bytesSinceLastSample / 1024 / 1024 / ((now - lastSampleTime) / 1000),
          });
          lastSampleTime = now;
          bytesSinceLastSample = 0;
        }
      }
    } finally {
      await handle?.close();
      await unlink(target).catch(() => {});
    }
    const elapsedSeconds = (Date.now() - start) / 1000;
    const sizeMb = totalBytes / 1024 / 1024;
    return { mbPerSecond: sizeMb / elapsedSeconds, elapsedSeconds, sizeMb, samples };
  });
}
