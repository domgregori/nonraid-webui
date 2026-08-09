import { open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { runSudoMaybe } from './procUtil.js';

export interface BenchmarkResult {
  mbPerSecond: number;
  elapsedSeconds: number;
  sizeMb: number;
}

const WRITE_SIZE_MB = 512; // hdparm -t (read) picks its own sample size; this is only for the write path
const BENCHMARK_FILENAME = '.nonraid-benchmark-tmp';
const HDPARM_SUMMARY_RE = /(\d+(?:\.\d+)?)\s*MB\s+in\s+(\d+(?:\.\d+)?)\s*seconds\s*=\s*(\d+(?:\.\d+)?)\s*MB\/sec/;

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
 * `hdparm -t` times buffered disk reads — purpose-built for exactly this, and already a real
 * dependency on this deployment (installed for spin control). Reuses the same bin/sudo config as
 * spinDown/spinUp in hdparm.ts.
 */
export async function benchmarkRead(device: string): Promise<BenchmarkResult> {
  return withLock(async () => {
    const { stdout } = await runSudoMaybe(config.hdparmBin, ['-t', devicePath(device)], config.hdparmUseSudo);
    const match = stdout.match(HDPARM_SUMMARY_RE);
    if (!match) throw new Error(`Could not parse hdparm output: ${stdout.trim() || '(empty)'}`);
    const [, mb, seconds, mbPerSec] = match;
    return { mbPerSecond: Number(mbPerSec), elapsedSeconds: Number(seconds), sizeMb: Number(mb) };
  });
}

/**
 * Writes a throwaway file through the disk's own existing mount, times it, deletes it — never
 * touches raw sectors, so this is safe on any mounted disk including an active array member.
 * `handle.sync()` (fsync) forces the data all the way to the device before timing stops, so this
 * reflects real sustained write speed rather than a page-cache write. Plain fs, no subprocess: the
 * backend already runs as root on the real deployment (confirmed live — the systemd unit has no
 * User=), so no sudo wrapping is needed for a normal file write.
 */
export async function benchmarkWrite(mountpoint: string): Promise<BenchmarkResult> {
  return withLock(async () => {
    const target = path.join(mountpoint, BENCHMARK_FILENAME);
    const chunk = Buffer.alloc(1024 * 1024);
    const start = Date.now();
    let handle;
    try {
      handle = await open(target, 'w');
      for (let i = 0; i < WRITE_SIZE_MB; i++) {
        await handle.write(chunk);
      }
      await handle.sync();
    } finally {
      await handle?.close();
      await unlink(target).catch(() => {});
    }
    const elapsedSeconds = (Date.now() - start) / 1000;
    return { mbPerSecond: WRITE_SIZE_MB / elapsedSeconds, elapsedSeconds, sizeMb: WRITE_SIZE_MB };
  });
}
