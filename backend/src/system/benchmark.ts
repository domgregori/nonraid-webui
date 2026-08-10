import { spawn } from 'node:child_process';
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
// The caller picks the duration (see resolveDurationMs); MAX_MB is a generous safety ceiling for the
// opposite case (an unexpectedly fast device, or a deliberately long test) — 16GB is still a small
// fraction of any real disk in this app's NAS context, so it only ever caps a genuinely fast/long
// combination rather than a normal run.
export const DEFAULT_BENCHMARK_DURATION_SECONDS = 4;
const MIN_DURATION_MS = 1000;
const MAX_DURATION_MS = 10 * 60 * 1000;
const SAMPLE_INTERVAL_MS = 250;
const MAX_MB = 16384;
const READ_CHUNK_BYTES = 4 * 1024 * 1024;
const WRITE_CHUNK_BYTES = 1024 * 1024;
const BENCHMARK_FILENAME = '.nonraid-benchmark-tmp';

// NmdDisk.device (from nmdctl status) is a bare name like "sdd4" — same idiom as
// hdparm.ts's own devicePath().
function devicePath(device: string): string {
  return device.startsWith('/dev/') ? device : `/dev/${device}`;
}

/**
 * Validates and converts a client-supplied duration (seconds) into milliseconds, clamped to a sane
 * range — null on invalid input (not a positive number), which route handlers turn into a 400
 * rather than letting a nonsense value silently become e.g. a 10-minute benchmark. Undefined/null
 * input (the param wasn't supplied) falls back to the existing 4s default rather than being an error,
 * so existing callers that don't yet pass a duration keep working unchanged.
 */
export function resolveDurationMs(durationSeconds: unknown): number | null {
  if (durationSeconds === undefined || durationSeconds === null) {
    return DEFAULT_BENCHMARK_DURATION_SECONDS * 1000;
  }
  const n = Number(durationSeconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.max(n * 1000, MIN_DURATION_MS), MAX_DURATION_MS);
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

const DD_BYTES_RE = /^(\d+) bytes/;

/**
 * Reads sequentially from the start of the raw device for up to durationMs (or MAX_MB, whichever
 * comes first), sampling instantaneous throughput every SAMPLE_INTERVAL_MS so callers can chart
 * speed over time, not just a single aggregate number.
 *
 * Shells out to `dd ... iflag=direct` rather than reading via Node's own fs — reading the raw
 * device (rather than a file, like benchmarkWrite does) already sidesteps filesystem-level
 * caching, but the block device's own page cache entries are a separate, real effect on top of
 * that: confirmed live, re-reading the same first 400MB of a spinning disk went from 198 MB/s to
 * 6.9 GB/s purely from cache — a 35x inflation a second benchmark run (or anything else that
 * happened to read the same region) would silently report as real. iflag=direct bypasses the page
 * cache entirely and confirmed live flattens both runs back to ~200 MB/s consistently. This can't
 * be done from pure Node: O_DIRECT requires the read buffer's underlying memory to be aligned to
 * the device's sector size, and there's no portable way to get aligned memory from a JS Buffer —
 * confirmed live, every offset in a 4096-byte window still failed with EINVAL, meaning the
 * backing ArrayBuffer's own base address isn't aligned either, which pure JS can't control
 * without a native addon. `dd`'s own C implementation handles this correctly.
 *
 * Sampling: `dd` only auto-prints progress (status=progress) about once a second, coarser than
 * this app's 250ms cadence — instead this polls by sending it SIGUSR1 on its own timer, which
 * (GNU coreutils dd) forces an immediate one-line stats report to stderr on demand, so the actual
 * sample rate is fully this code's choice, not dd's.
 */
export async function benchmarkRead(device: string, durationMs: number): Promise<BenchmarkResult> {
  return withLock(async () => {
    const target = devicePath(device);
    const samples: BenchmarkSample[] = [];
    const start = Date.now();
    let lastSampleTime = start;
    let lastSampleBytes = 0;
    let totalBytes = 0;
    let stderrTail = '';

    await new Promise<void>((resolve, reject) => {
      const child = spawn('dd', [`if=${target}`, 'of=/dev/null', `bs=${READ_CHUNK_BYTES}`, 'iflag=direct'], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stopping = false;
      let buf = '';

      const stop = (signal: NodeJS.Signals) => {
        stopping = true;
        clearInterval(pollTimer);
        clearTimeout(durationTimer);
        child.kill(signal);
      };

      const pollTimer = setInterval(() => child.kill('SIGUSR1'), SAMPLE_INTERVAL_MS);
      const durationTimer = setTimeout(() => stop('SIGTERM'), durationMs);

      child.stderr.on('data', (data: Buffer) => {
        buf += data.toString('utf8');
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          stderrTail = line;
          const m = line.match(DD_BYTES_RE);
          if (!m) continue;
          totalBytes = Number(m[1]);
          const now = Date.now();
          samples.push({
            elapsedSeconds: (now - start) / 1000,
            mbPerSecond: (totalBytes - lastSampleBytes) / 1024 / 1024 / Math.max((now - lastSampleTime) / 1000, 0.001),
          });
          lastSampleTime = now;
          lastSampleBytes = totalBytes;
          if (totalBytes >= MAX_MB * 1024 * 1024) stop('SIGTERM');
        }
      });

      child.on('error', (err) => {
        clearInterval(pollTimer);
        clearTimeout(durationTimer);
        reject(err);
      });
      child.on('close', (code) => {
        clearInterval(pollTimer);
        clearTimeout(durationTimer);
        // A non-zero exit we didn't cause ourselves (stop() always signals SIGTERM/SIGUSR1, which
        // report as a null code with a signal, not a numeric one) and no bytes read at all means
        // dd itself refused to run — e.g. iflag=direct unsupported on this particular device.
        if (!stopping && code !== 0 && totalBytes === 0) {
          reject(new Error(stderrTail || `dd exited with code ${code}`));
          return;
        }
        resolve();
      });
    });

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
export async function benchmarkWrite(mountpoint: string, durationMs: number): Promise<BenchmarkResult> {
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
      while (Date.now() - start < durationMs && totalBytes < MAX_MB * 1024 * 1024) {
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
