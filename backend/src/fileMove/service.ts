import { execFile } from 'node:child_process';
import { copyFile, mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { HttpError } from '../httpError.js';
import type { AllocationMethod, Share } from '../shares/types.js';
import type { FileMoveJobState, FileMovePlanSummary, FileMoveUnfitExample } from './types.js';

const execFileAsync = promisify(execFile);
const STAT_CONCURRENCY = 64;
const MAX_UNFIT_EXAMPLES = 20;

interface PlanItem {
  share: string;
  relativePath: string; // within the share, e.g. "movies/foo.mkv"
  absSource: string;
  sizeBytes: number;
  destSlot: number;
}

interface StoredPlan {
  sourceId: string;
  fits: boolean;
  items: PlanItem[];
}

export interface PlanParams {
  /** Opaque label for this source — display/logging only (e.g. "disk:3", "cache"). */
  sourceId: string;
  sourceMountpoint: string;
  /** Shares to draw files from — caller filters this to whatever's relevant for the source
   *  (e.g. EmptyDiskService: shares whose disks include the slot being emptied; the cache mover:
   *  every cache-eligible share). */
  shares: Share[];
  /** Valid destination array disks, slot -> mountpoint. */
  destMounts: Map<number, string>;
  /** Excluded from destination candidates — set by EmptyDiskService to the slot being emptied
   *  (its own disk can't be a destination for its own files); left undefined for sources that
   *  aren't themselves an array slot, like the cache mount. */
  excludeDestSlot?: number;
}

function idleJobState(): FileMoveJobState {
  return {
    sourceId: null,
    status: 'idle',
    totalBytes: 0,
    movedBytes: 0,
    totalFiles: 0,
    movedFiles: 0,
    currentFile: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  };
}

async function dfAvailBytes(mountpoint: string): Promise<number> {
  const { stdout } = await execFileAsync('df', ['-B1', '--output=avail', mountpoint], { timeout: 10_000 });
  const lines = stdout.trim().split('\n');
  const n = Number(lines[lines.length - 1]?.trim());
  if (!Number.isFinite(n)) throw new Error(`Could not read free space for ${mountpoint}`);
  return n;
}

async function listFilesUnder(dir: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('find', [dir, '-type', 'f', '-print0'], {
      timeout: 300_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout.split('\0').filter(Boolean);
  } catch (err) {
    // find exits non-zero if e.g. a subdirectory disappears mid-walk (race with
    // something else touching the disk) — best-effort, whatever it printed
    // before failing is still useful, so only hard-fail if it printed nothing.
    const e = err as { stdout?: string };
    if (e.stdout) return e.stdout.split('\0').filter(Boolean);
    throw err;
  }
}

async function listTopLevelDirs(dir: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('find', [dir, '-mindepth', '1', '-maxdepth', '1'], { timeout: 15_000 });
    return stdout.split('\n').filter(Boolean).map((p) => path.basename(p));
  } catch {
    return [];
  }
}

async function duBytes(dir: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('du', ['-sb', dir], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    return Number(stdout.split('\t')[0]) || 0;
  } catch {
    return 0;
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Candidate destination disk order/pick for one file, per the share's own allocation method — see realApplier.ts's mergerfsPolicy for the mount-time equivalent this mirrors. */
function pickDestination(
  candidates: number[],
  simulatedFree: Map<number, number>,
  sizeBytes: number,
  method: AllocationMethod,
): number | null {
  const fitting = candidates.filter((slot) => (simulatedFree.get(slot) ?? 0) >= sizeBytes);
  if (fitting.length === 0) return null;
  if (method === 'fill-up') {
    // mergerfs "ff": first branch, in configured order, with enough room — fills one disk before the next.
    return fitting[0]!;
  }
  // most-free / high-water / single-disk: most-free is a reasonable stand-in for all three here —
  // true high-water semantics depend on mergerfs's live capacity-fraction math, not worth
  // reproducing exactly for a planning simulation (see realApplier.ts's own comment on this).
  return fitting.reduce((best, slot) => ((simulatedFree.get(slot) ?? 0) > (simulatedFree.get(best) ?? 0) ? slot : best));
}

/**
 * Generic engine behind both "empty this disk onto the rest of the array" (emptyDisk/service.ts)
 * and "drain the cache mirror onto the array" (the cache mover) — moving a disk's real files onto
 * some other disks, bin-packed per each share's own allocation policy, is the same operation
 * whether the source is an array slot being retired or the cache pool being drained on a schedule.
 * Simulates the whole move first (plan()) and refuses to start if anything doesn't fit anywhere,
 * rather than discovering that mid-move with the source half emptied. Runs the real move as a
 * background job (start()/status()/cancel()) since real data can take hours — each file is copied
 * and size-verified before its source is ever unlinked, so an interrupted job just leaves both a
 * valid copy and a valid original for whatever it hadn't gotten to yet, safely resumable by
 * planning and starting again.
 *
 * Each owner (EmptyDiskService, the cache mover) constructs its own instance — single-flight is
 * per-instance, not global, so an empty-disk job and a mover run don't block each other.
 */
export class FileMoveService {
  private plan_: StoredPlan | null = null;
  private job: FileMoveJobState = idleJobState();
  private cancelRequested = false;

  async plan(params: PlanParams): Promise<FileMovePlanSummary> {
    if (this.job.status === 'running' || this.job.status === 'planning') {
      throw new HttpError(409, 'Another move operation is already in progress.');
    }

    const { sourceId, sourceMountpoint, shares, destMounts, excludeDestSlot } = params;

    // Free space of every eligible destination disk, for the bin-pack simulation.
    const destSlots = [...destMounts.keys()].filter((s) => s !== excludeDestSlot);
    const freeEntries = await Promise.all(destSlots.map(async (s): Promise<[number, number]> => [s, await dfAvailBytes(destMounts.get(s)!)]));
    const simulatedFree = new Map<number, number>(freeEntries);

    // Enumerate real files under each relevant share's directory on the source.
    const items: PlanItem[] = [];
    for (const share of shares) {
      const shareDir = `${sourceMountpoint}/${share.name}`;
      const files = await listFilesUnder(shareDir);
      const stats = await mapWithConcurrency(files, STAT_CONCURRENCY, async (f) => ({ f, st: await stat(f).catch(() => null) }));
      for (const { f, st } of stats) {
        if (!st) continue; // vanished between find and stat — skip, not this plan's problem
        items.push({ share: share.name, relativePath: path.relative(shareDir, f), absSource: f, sizeBytes: st.size, destSlot: -1 });
      }
    }

    // Anything on the source NOT under a configured share for it — left behind, the caller needs to know.
    const shareNames = new Set(shares.map((s) => s.name));
    const topLevel = await listTopLevelDirs(sourceMountpoint);
    const unmanagedDirs = topLevel.filter((name) => !shareNames.has(name));
    const unmanagedBytes = (await Promise.all(unmanagedDirs.map((name) => duBytes(`${sourceMountpoint}/${name}`)))).reduce((a, b) => a + b, 0);

    // First-fit-decreasing: biggest files placed first gives a meaningfully
    // better pack rate than arrival order, at negligible extra cost here.
    items.sort((a, b) => b.sizeBytes - a.sizeBytes);

    const shareByName = new Map(shares.map((s) => [s.name, s]));
    const perDestinationBytes: Record<number, number> = {};
    const unfitExamples: FileMoveUnfitExample[] = [];
    let fits = true;

    for (const item of items) {
      const share = shareByName.get(item.share)!;
      const candidates = share.disks.filter((d) => d !== excludeDestSlot && simulatedFree.has(d));
      const dest = pickDestination(candidates, simulatedFree, item.sizeBytes, share.allocationMethod);
      if (dest === null) {
        fits = false;
        if (unfitExamples.length < MAX_UNFIT_EXAMPLES) {
          unfitExamples.push({ share: item.share, path: item.relativePath, sizeBytes: item.sizeBytes });
        }
        continue;
      }
      item.destSlot = dest;
      simulatedFree.set(dest, (simulatedFree.get(dest) ?? 0) - item.sizeBytes);
      perDestinationBytes[dest] = (perDestinationBytes[dest] ?? 0) + item.sizeBytes;
    }

    const totalBytes = items.reduce((s, i) => s + i.sizeBytes, 0);
    let unfitReason: string | null = null;
    if (!fits) {
      const noOtherDiskShares = shares.filter((s) => s.disks.filter((d) => d !== excludeDestSlot).length === 0);
      unfitReason =
        noOtherDiskShares.length > 0
          ? `Share(s) ${noOtherDiskShares.map((s) => `"${s.name}"`).join(', ')} have nowhere for their files to go. Add another disk to the share first.`
          : `Not enough free space on the disks this data is allowed to live on (per each share's configured disks).`;
    }

    this.plan_ = { sourceId, fits, items: fits ? items : [] };

    return {
      sourceId,
      fits,
      fileCount: items.length,
      totalBytes,
      perDestinationBytes,
      unfitExamples,
      unfitReason,
      unmanagedBytes,
    };
  }

  status(): FileMoveJobState {
    return this.job;
  }

  async start(sourceId: string, destMounts: Map<number, string>): Promise<void> {
    if (this.job.status === 'running' || this.job.status === 'planning') {
      throw new HttpError(409, 'Another move operation is already in progress.');
    }
    const plan = this.plan_;
    if (!plan || plan.sourceId !== sourceId || !plan.fits) {
      throw new HttpError(400, `No valid plan for "${sourceId}" — run the check again first.`);
    }

    this.cancelRequested = false;
    this.job = {
      sourceId,
      status: 'running',
      totalBytes: plan.items.reduce((s, i) => s + i.sizeBytes, 0),
      movedBytes: 0,
      totalFiles: plan.items.length,
      movedFiles: 0,
      currentFile: null,
      error: null,
      startedAt: Date.now(),
      finishedAt: null,
    };

    // Deliberately not awaited — this can run for hours against real data;
    // the caller polls status() instead, same pattern as nmdctl's resync.
    this.run(plan, destMounts).catch((err) => {
      this.job = { ...this.job, status: 'failed', error: (err as Error).message, finishedAt: Date.now() };
    });
  }

  cancel(): void {
    if (this.job.status === 'running') this.cancelRequested = true;
  }

  private async run(plan: StoredPlan, destMounts: Map<number, string>): Promise<void> {
    const errors: string[] = [];

    for (const item of plan.items) {
      if (this.cancelRequested) {
        this.job = { ...this.job, status: 'cancelled', finishedAt: Date.now() };
        return;
      }

      this.job = { ...this.job, currentFile: `${item.share}/${item.relativePath}` };

      try {
        const destMount = destMounts.get(item.destSlot);
        if (!destMount) throw new Error(`Destination disk (slot ${item.destSlot}) is no longer mounted.`);
        const destPath = `${destMount}/${item.share}/${item.relativePath}`;
        await mkdir(path.dirname(destPath), { recursive: true });

        const destExists = await stat(destPath).then((s) => s.size, () => null);
        if (destExists !== item.sizeBytes) {
          await copyFile(item.absSource, destPath);
          const verify = await stat(destPath);
          if (verify.size !== item.sizeBytes) {
            throw new Error(`Size mismatch after copy (source ${item.sizeBytes}, destination ${verify.size}) — leaving source in place.`);
          }
        }
        // Copy verified (or a prior partial run already got here) — now safe to remove the source.
        await unlink(item.absSource);

        this.job = {
          ...this.job,
          movedBytes: this.job.movedBytes + item.sizeBytes,
          movedFiles: this.job.movedFiles + 1,
        };
      } catch (err) {
        errors.push(`${item.share}/${item.relativePath}: ${(err as Error).message}`);
      }
    }

    this.plan_ = null;
    this.job = {
      ...this.job,
      status: 'done',
      currentFile: null,
      error: errors.length > 0 ? `${errors.length} file(s) failed to move — see server log.` : null,
      finishedAt: Date.now(),
    };
    if (errors.length > 0) console.error('FileMoveService: file errors:\n' + errors.join('\n'));
  }
}
