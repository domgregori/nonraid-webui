import { execFile } from 'node:child_process';
import { copyFile, mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { HttpError } from '../httpError.js';
import type { NmdClient } from '../nmd/index.js';
import type { ShareStore } from '../shares/index.js';
import type { AllocationMethod, Share } from '../shares/types.js';
import type { EmptyDiskJobState, EmptyDiskPlanSummary, UnfitExample } from './types.js';

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
  slot: number;
  fits: boolean;
  items: PlanItem[];
}

function idleJobState(): EmptyDiskJobState {
  return {
    slot: null,
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
 * Moves a disk's real files off onto the array's other disks, so the disk can
 * then be safely unassigned via the existing Unassign/Restore/Replace flow —
 * this service only ever handles the data-movement half. Simulates the whole
 * move first (plan()) and refuses to start if anything doesn't fit anywhere,
 * rather than discovering that mid-move with a disk half emptied. Runs the
 * real move as a background job (start()/status()/cancel()) since real data
 * can take hours — each file is copied and size-verified before its source
 * is ever unlinked, so an interrupted job just leaves both a valid copy and
 * a valid original for whatever it hadn't gotten to yet, safely resumable by
 * planning and starting again.
 */
export class EmptyDiskService {
  private plans = new Map<number, StoredPlan>();
  private job: EmptyDiskJobState = idleJobState();
  private cancelRequested = false;

  constructor(
    private nmd: NmdClient,
    private shareStore: ShareStore,
  ) {}

  private async dataDiskMountpoints(): Promise<Map<number, string>> {
    const status = await this.nmd.getStatus();
    const mounts = new Map<number, string>();
    for (const d of status.disks) {
      if (d.type !== 'data') continue;
      const mp = d.filesystem?.mountpoint;
      if (mp && mp !== '-') mounts.set(d.slot, mp);
    }
    return mounts;
  }

  async plan(slot: number): Promise<EmptyDiskPlanSummary> {
    if (this.job.status === 'running' || this.job.status === 'planning') {
      throw new HttpError(409, 'Another empty-disk operation is already in progress.');
    }

    const [mounts, shares] = await Promise.all([this.dataDiskMountpoints(), this.shareStore.list()]);
    const sourceMount = mounts.get(slot);
    if (!sourceMount) throw new HttpError(400, `Slot ${slot} isn't a mounted data disk.`);

    const relevantShares = shares.filter((s) => s.disks.includes(slot));

    // Free space of every OTHER mounted data disk, for the bin-pack simulation.
    const otherSlots = [...mounts.keys()].filter((s) => s !== slot);
    const freeEntries = await Promise.all(otherSlots.map(async (s): Promise<[number, number]> => [s, await dfAvailBytes(mounts.get(s)!)]));
    const simulatedFree = new Map<number, number>(freeEntries);

    // Enumerate real files under each relevant share's directory on this disk.
    const items: PlanItem[] = [];
    for (const share of relevantShares) {
      const shareDir = `${sourceMount}/${share.name}`;
      const files = await listFilesUnder(shareDir);
      const stats = await mapWithConcurrency(files, STAT_CONCURRENCY, async (f) => ({ f, st: await stat(f).catch(() => null) }));
      for (const { f, st } of stats) {
        if (!st) continue; // vanished between find and stat — skip, not this plan's problem
        items.push({ share: share.name, relativePath: path.relative(shareDir, f), absSource: f, sizeBytes: st.size, destSlot: -1 });
      }
    }

    // Anything on this disk NOT under a configured share for it — left behind, the caller needs to know.
    const shareNames = new Set(relevantShares.map((s) => s.name));
    const topLevel = await listTopLevelDirs(sourceMount);
    const unmanagedDirs = topLevel.filter((name) => !shareNames.has(name));
    const unmanagedBytes = (await Promise.all(unmanagedDirs.map((name) => duBytes(`${sourceMount}/${name}`)))).reduce((a, b) => a + b, 0);

    // First-fit-decreasing: biggest files placed first gives a meaningfully
    // better pack rate than arrival order, at negligible extra cost here.
    items.sort((a, b) => b.sizeBytes - a.sizeBytes);

    const shareBySlotAndName = new Map(relevantShares.map((s) => [s.name, s]));
    const perDestinationBytes: Record<number, number> = {};
    const unfitExamples: UnfitExample[] = [];
    let fits = true;

    for (const item of items) {
      const share = shareBySlotAndName.get(item.share)!;
      const candidates = share.disks.filter((d) => d !== slot && simulatedFree.has(d));
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
      const noOtherDiskShares = relevantShares.filter((s) => s.disks.filter((d) => d !== slot).length === 0);
      unfitReason =
        noOtherDiskShares.length > 0
          ? `Share(s) ${noOtherDiskShares.map((s) => `"${s.name}"`).join(', ')} only include this disk — there's nowhere for their files to go. Add another disk to the share first.`
          : `Not enough free space on the other disks this data is allowed to live on (per each share's configured disks).`;
    }

    this.plans.set(slot, { slot, fits, items: fits ? items : [] });

    return {
      slot,
      fits,
      fileCount: items.length,
      totalBytes,
      perDestinationBytes,
      unfitExamples,
      unfitReason,
      unmanagedBytes,
    };
  }

  status(): EmptyDiskJobState {
    return this.job;
  }

  async start(slot: number): Promise<void> {
    if (this.job.status === 'running' || this.job.status === 'planning') {
      throw new HttpError(409, 'Another empty-disk operation is already in progress.');
    }
    const plan = this.plans.get(slot);
    if (!plan || !plan.fits) {
      throw new HttpError(400, `No valid plan for slot ${slot} — run the check again first.`);
    }

    const mounts = await this.dataDiskMountpoints();
    this.cancelRequested = false;
    this.job = {
      slot,
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
    this.run(plan, mounts).catch((err) => {
      this.job = { ...this.job, status: 'failed', error: (err as Error).message, finishedAt: Date.now() };
    });
  }

  cancel(): void {
    if (this.job.status === 'running') this.cancelRequested = true;
  }

  private async run(plan: StoredPlan, mounts: Map<number, string>): Promise<void> {
    const errors: string[] = [];

    for (const item of plan.items) {
      if (this.cancelRequested) {
        this.job = { ...this.job, status: 'cancelled', finishedAt: Date.now() };
        return;
      }

      this.job = { ...this.job, currentFile: `${item.share}/${item.relativePath}` };

      try {
        const destMount = mounts.get(item.destSlot);
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

    this.plans.delete(plan.slot);
    this.job = {
      ...this.job,
      status: 'done',
      currentFile: null,
      error: errors.length > 0 ? `${errors.length} file(s) failed to move — see server log.` : null,
      finishedAt: Date.now(),
    };
    if (errors.length > 0) console.error('EmptyDiskService: file errors:\n' + errors.join('\n'));
  }
}
