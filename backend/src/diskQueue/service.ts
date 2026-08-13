import { randomUUID } from 'node:crypto';
import type { CacheService } from '../cache/service.js';
import { HttpError } from '../httpError.js';
import type { ActivityStore } from '../activity/index.js';
import type { NmdClient, NmdStatusResponse } from '../nmd/index.js';
import type { DiskQueueItem, DiskQueueItemType, DiskQueueState } from './types.js';

const RESYNC_POLL_MS = 5_000;
const MAX_CONSECUTIVE_POLL_FAILURES = 5;
// nmdctl's CANCEL never re-arms a resync on its own — a cancelled clear/rebuild leaves
// resync.pending stuck true forever (confirmed live: cancelling a queue-driven disk clear via the
// Parity Check card's Cancel button left pending=true/active=false indefinitely). The normal
// pending-without-active window (the moment between startArray() and parityCheck() kicking in) is
// a single poll at most, so several in a row this long is a reliable signal of exactly that
// external-cancel case, not a slow-but-legitimate transition.
const MAX_CONSECUTIVE_PENDING_ONLY_POLLS = 6;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeItem(item: DiskQueueItem): string {
  if (item.type === 'add-cache-mirror') return `Cache mirror (${item.label})`;
  const input = item.input as { slot: number; device: string };
  const roleLabel = item.type === 'add-parity' ? 'Parity disk' : 'Data disk';
  return `${roleLabel} (${item.label}) in slot ${input.slot}`;
}

/**
 * Single backend-owned FIFO queue for the "add" family of disk operations (add parity disk, add
 * data disk, add cache mirror) — see this project's plan doc for the full rationale. Runs items
 * one at a time, never starting the next until the current one has *fully* completed, including
 * waiting out any background resync it triggered (see waitForResyncIdle) — not just the initial
 * nmdctl call returning. A failure pauses the queue rather than skipping ahead, so nothing ever
 * runs against a possibly-inconsistent array without a human looking at it first (see runLoop).
 *
 * In-memory only, lost on a backend restart — same model as every other background job in this
 * app (FileMoveService, EmptyDiskService, CacheMoverService): nothing here is precious enough to
 * persist, and a mid-resync backend restart isn't a state this queue can safely resume into
 * anyway (the array itself, via nmdctl, is the actual source of truth for what's in progress).
 *
 * Also the single writer for these three operation types: routes/diskQueue.ts is the only caller
 * of nmd.addDisk()/cache.setup() left in the app (AddDiskDialog/CacheSetupDialog enqueue instead
 * of calling their old routes directly) — see routes/disks.ts and routes/cache.ts for the
 * advisory 409 lock this imposes on Format/Unassign/Replace/Cache-Replace while busy.
 *
 * Cache-mirror items deliberately get no special-casing for the FIFO-wait requirement: this is
 * one queue, not parallel lanes, so a queued cache item already waits behind a running
 * add-parity/add-data item for free just by being later in `items` — that's intentional, not an
 * oversight to "optimize" away later. Cache setup itself never touches nmdctl/array state, so it
 * has no resync to wait out — see runCacheMirrorItem.
 */
export class DiskQueueService {
  private items: DiskQueueItem[] = [];
  private processing = false;

  constructor(
    private nmd: NmdClient,
    private cache: CacheService,
    private activity: ActivityStore,
  ) {}

  list(): DiskQueueState {
    return { items: [...this.items], paused: this.isPaused() };
  }

  /** Used by other routes (Format/Unassign/Replace/Cache-Replace) for the advisory 409 lock. */
  isBusy(): boolean {
    return this.processing;
  }

  /** Device paths claimed by a queue item that hasn't finished successfully — queued, running,
   *  or failed (a failed item pauses the queue at the head rather than disappearing, so its
   *  device is still "spoken for" until the user retries or removes it). Used by
   *  /disks/available to hide a disk already in the queue from Unassigned Devices — confirmed
   *  live: without this, the same physical disk could be enqueued a second time while its first
   *  queue item was still waiting its turn, since nothing had claimed it from nmdctl's own point
   *  of view yet. 'done' items are deliberately excluded: by then the disk is either actually in
   *  the array (nmdctl's own listing already excludes it) or was a cache-mirror member (the
   *  existing btrfs-claim check already excludes those) — no separate hold needed here either way. */
  queuedDevicePaths(): Set<string> {
    const paths = new Set<string>();
    for (const item of this.items) {
      if (item.status === 'done') continue;
      if ('device' in item.input) {
        paths.add(item.input.device);
      } else {
        paths.add(item.input.deviceA);
        paths.add(item.input.deviceB);
      }
    }
    return paths;
  }

  enqueueAddDisk(type: Extract<DiskQueueItemType, 'add-parity' | 'add-data'>, slot: number, device: string, label: string): DiskQueueItem {
    const item: DiskQueueItem = {
      id: randomUUID(),
      type,
      input: { slot, device },
      status: 'queued',
      phase: null,
      label,
      enqueuedAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      error: null,
      note: null,
    };
    this.items.push(item);
    this.kick();
    return item;
  }

  enqueueCacheMirror(deviceA: string, deviceB: string, label: string): DiskQueueItem {
    const item: DiskQueueItem = {
      id: randomUUID(),
      type: 'add-cache-mirror',
      input: { deviceA, deviceB },
      status: 'queued',
      phase: null,
      label,
      enqueuedAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      error: null,
      note: null,
    };
    this.items.push(item);
    this.kick();
    return item;
  }

  /** Only valid on the paused failed item at the head of the queue — see class doc comment. */
  retry(id: string): void {
    const head = this.items.find((i) => i.status !== 'done');
    if (!head || head.id !== id || head.status !== 'failed') {
      throw new HttpError(409, 'Only the paused failed item at the head of the queue can be retried.');
    }
    head.status = 'queued';
    head.phase = null;
    head.error = null;
    this.kick();
  }

  /** Valid on any still-queued item, or the paused failed head — removing the failed head
   *  unpauses the queue and lets it continue. A running item can't be removed (see class doc
   *  comment on why cancel-in-flight isn't supported), nor a done one (history only). */
  remove(id: string): void {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) throw new HttpError(404, 'No such queue item.');
    const item = this.items[idx]!;
    if (item.status === 'running') throw new HttpError(409, 'Cannot remove a currently running item.');
    if (item.status === 'done') throw new HttpError(409, 'Cannot remove a completed item — it is history only.');
    const wasFailed = item.status === 'failed';
    this.items.splice(idx, 1);
    if (wasFailed) this.kick();
  }

  /** Drops every still-queued item; if the head is a paused failed item, drops that too
   *  (unpausing to an empty queue). Running/done items are left alone. */
  clear(): void {
    this.items = this.items.filter((i) => i.status === 'running' || i.status === 'done');
  }

  private isPaused(): boolean {
    const head = this.items.find((i) => i.status !== 'done');
    return head?.status === 'failed';
  }

  /** Fires the processing loop without awaiting it — same fire-and-forget shape as
   *  FileMoveService.start()'s own run(). No-op if the loop is already running; it'll pick up
   *  anything newly queued on its own next iteration. */
  private kick(): void {
    if (this.processing) return;
    this.runLoop().catch(() => {});
  }

  private async runLoop(): Promise<void> {
    this.processing = true;
    try {
      for (;;) {
        const head = this.items.find((i) => i.status !== 'done');
        if (!head || head.status === 'failed') return; // nothing left to do, or paused on a failure

        head.status = 'running';
        head.startedAt = Date.now();
        try {
          await this.runItem(head);
          head.status = 'done';
          head.phase = null;
          head.finishedAt = Date.now();
          if (head.note) {
            this.activity.log(head.note, 'amber').catch(() => {});
          } else {
            this.activity.log(`${describeItem(head)} completed`, 'green').catch(() => {});
          }
          this.pruneHistory();
        } catch (err) {
          head.status = 'failed';
          head.phase = null;
          head.error = (err as Error).message;
          head.finishedAt = Date.now();
          this.activity.log(`${describeItem(head)} failed: ${head.error}`, 'red').catch(() => {});
          return; // pause — do not skip ahead to whatever's queued next
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /** Keeps only the 5 most-recent `done` items, dropping older ones — queued/running/failed items
   *  are never touched here. */
  private pruneHistory(): void {
    const doneCount = this.items.filter((i) => i.status === 'done').length;
    let toDrop = doneCount - 5;
    if (toDrop <= 0) return;
    this.items = this.items.filter((item) => {
      if (item.status === 'done' && toDrop > 0) {
        toDrop--;
        return false;
      }
      return true;
    });
  }

  private async runItem(item: DiskQueueItem): Promise<void> {
    if (item.type === 'add-cache-mirror') {
      await this.runCacheMirrorItem(item);
    } else {
      await this.runAddDiskItem(item);
    }
  }

  /**
   * add-parity / add-data: mirrors ArrayBuilder.tsx's own hand-rolled stop/add/start/check
   * sequence (see that component's doc comment for why nmdctl needs exactly this order), moved
   * server-side and generalized to run for any slot, not just the onboarding wizard's first two
   * disks. Re-validates the device via a fresh scan rather than trusting the enqueue-time
   * snapshot — a device could be gone, reformatted, or claimed by something else by the time this
   * item's turn actually comes up.
   */
  private async runAddDiskItem(item: DiskQueueItem): Promise<void> {
    const input = item.input as { slot: number; device: string };
    item.phase = 'committing';

    const available = await this.nmd.listAvailableDevices();
    const match = available.find((d) => d.device === input.device);
    if (!match) {
      throw new Error(
        `${input.device} is not currently available — it may have been removed, reformatted, or claimed elsewhere since this was queued.`,
      );
    }
    // Same rule routes/disks.ts's /disks/:slot/add follows: the specific free partition when the
    // scan found one, never the whole parent device unless the disk genuinely has none.
    const target = match.partition ?? match.device;

    const status = await this.nmd.getStatus();
    // A resync active for any reason outside this queue's own bookkeeping — a manually-started
    // parity check, another disk's rebuild kicked off outside the queue, etc. — must never be
    // interrupted: stopping the array mid-resync is the exact failure mode this whole feature
    // exists to prevent (see class doc comment). A prior *queue* item's own resync can never
    // still be active here (waitForResyncIdle() already confirmed it wasn't before this item's
    // turn began), so this only fires for genuinely external activity — fail cleanly and let the
    // queue pause rather than risk it.
    if (status.resync.active) {
      throw new Error('A parity check or resync is already active outside the queue — wait for it to finish, then retry.');
    }
    if (status.array.state === 'STARTED') {
      // The queue now owns this transition — unlike the old direct route, callers here never
      // stopped the array themselves first.
      await this.nmd.stopArray();
    }

    await this.nmd.addDisk(input.slot, target, match.diskId ?? undefined, { autoStart: false });
    try {
      await this.nmd.startArray();
    } catch (err) {
      // A parity-only array (no data disks assigned yet) refuses to start at all — nothing to
      // protect yet, confirmed live via ERROR:NO_DATA_DISKS. This is expected, not a real
      // failure: the disk itself is already correctly committed to its slot (addDisk() above
      // succeeded), it just can't clear/build parity until a data disk joins it too. Treat it as
      // done rather than failed, so a data disk already queued behind this one isn't blocked on
      // a manual Remove for something that was never actually wrong — it'll pick this parity
      // disk right up on its own turn.
      const afterFailedStart = await this.nmd.getStatus().catch(() => null);
      if (afterFailedStart?.array.state === 'ERROR:NO_DATA_DISKS') {
        item.note = `${describeItem(item)} is in place but can't start yet — add at least one data disk to begin building parity.`;
        return;
      }
      throw err;
    }
    // start() alone only marks the pending clear/rebuild — parityCheck('CORRECT') is what
    // actually kicks it off running, same as ArrayBuilder.tsx and RealNmdClient.parityCheck()'s
    // own doc comments explain.
    await this.nmd.parityCheck('CORRECT');

    item.phase = 'awaiting-resync';
    await this.waitForResyncIdle();

    // waitForResyncIdle() only proves the driver stopped resyncing, not that this item's disk
    // actually made it in — confirmed live: manually unassigning the disk out from under a
    // running item also makes resync go idle, and without this check the item was recorded as a
    // false "done". Re-check the specific slot landed on DISK_OK before calling it a success.
    const finalStatus = await this.nmd.getStatus();
    const disk = finalStatus.disks.find((d) => d.slot === input.slot);
    if (!disk || disk.status !== 'DISK_OK') {
      throw new Error(
        `The resync stopped but slot ${input.slot} never reached a healthy state (status: ${disk?.status ?? 'unassigned'}) — it was likely cancelled or removed outside the queue.`,
      );
    }
  }

  /**
   * "Done" for add-parity/add-data isn't the API call returning — it's the background
   * clear/resync it triggered actually finishing. Polls on a setTimeout-based loop (never
   * setInterval) so one slow getStatus() call can't overlap the next, per-call timeout aside.
   * Throws after several consecutive failed status reads in a row rather than polling forever —
   * a transient blip shouldn't fail the item, but a genuinely broken status endpoint should.
   * Also throws if resync gets stuck pending-without-active for too long — see
   * MAX_CONSECUTIVE_PENDING_ONLY_POLLS's own comment for why that means an external cancel.
   */
  private async waitForResyncIdle(): Promise<void> {
    let consecutiveFailures = 0;
    let consecutivePendingOnly = 0;
    for (;;) {
      await sleep(RESYNC_POLL_MS);
      let status: NmdStatusResponse;
      try {
        status = await this.nmd.getStatus();
      } catch (err) {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
          throw new Error(
            `Could not read array status ${MAX_CONSECUTIVE_POLL_FAILURES} times in a row while waiting for the resync to finish: ${(err as Error).message}`,
          );
        }
        continue;
      }
      consecutiveFailures = 0;
      if (!status.resync.active && !status.resync.pending) return;

      if (!status.resync.active && status.resync.pending) {
        consecutivePendingOnly++;
        if (consecutivePendingOnly >= MAX_CONSECUTIVE_PENDING_ONLY_POLLS) {
          throw new Error(
            'The resync stopped running but never fully cleared — it was likely cancelled outside the queue (e.g. via the Parity Check card\'s Cancel button). Check the array and disk status before retrying.',
          );
        }
      } else {
        consecutivePendingOnly = 0;
      }
    }
  }

  /**
   * add-cache-mirror: no stopArray/startArray, no resync wait — cache setup never touches
   * nmdctl or array state at all, it's pure mkfs.btrfs + mount. The auto-retry-with-force-on-
   * existing-filesystem behavior used to live in CacheSetupDialog (see commit dc2248e); it moves
   * here now that the dialog's job is just "enqueue and close," with the actual mkfs call (and
   * whether it had to force-overwrite something) happening in this engine instead.
   */
  private async runCacheMirrorItem(item: DiskQueueItem): Promise<void> {
    const input = item.input as { deviceA: string; deviceB: string };
    item.phase = 'formatting';

    const available = await this.nmd.listAvailableDevices();
    for (const dev of [input.deviceA, input.deviceB]) {
      if (!available.some((d) => d.device === dev)) {
        throw new Error(`${dev} is not currently available — it may have been removed or claimed elsewhere since this was queued.`);
      }
    }

    try {
      await this.cache.setup(input.deviceA, input.deviceB);
    } catch (err) {
      const message = (err as Error).message;
      if (/use the -f option/i.test(message)) {
        await this.cache.setup(input.deviceA, input.deviceB, true);
      } else {
        throw err;
      }
    }
  }
}
