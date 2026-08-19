import { FileMoveService } from '../fileMove/service.js';
import { HttpError } from '../httpError.js';
import type { NmdClient } from '../nmd/index.js';
import type { ShareStore } from '../shares/index.js';
import type { EmptyDiskJobState, EmptyDiskPlanSummary } from './types.js';

const SOURCE_PREFIX = 'disk:';
const sourceId = (slot: number) => `${SOURCE_PREFIX}${slot}`;
const slotFromSourceId = (id: string | null) => (id?.startsWith(SOURCE_PREFIX) ? Number(id.slice(SOURCE_PREFIX.length)) : null);

/**
 * Moves a disk's real files off onto the array's other disks, so the disk can
 * then be safely unassigned via the existing Unassign/Restore/Replace flow -
 * this service only ever handles the data-movement half. Thin wrapper around
 * the generic FileMoveService (shared with the cache mover): resolves "slot N"
 * to a mountpoint + relevant shares + destination candidates (every other
 * mounted data disk), and translates between the engine's generic
 * sourceId-shaped types and this module's slot-shaped public API - the routes
 * and frontend consume EmptyDiskPlanSummary/EmptyDiskJobState directly and
 * are unchanged by this refactor.
 */
export class EmptyDiskService {
  private engine = new FileMoveService();

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
    const [mounts, shares] = await Promise.all([this.dataDiskMountpoints(), this.shareStore.list()]);
    const sourceMountpoint = mounts.get(slot);
    if (!sourceMountpoint) throw new HttpError(400, `Slot ${slot} isn't a mounted data disk.`);

    const relevantShares = shares.filter((s) => s.disks.includes(slot));

    const result = await this.engine.plan({
      sourceId: sourceId(slot),
      sourceMountpoint,
      shares: relevantShares,
      destMounts: mounts,
      excludeDestSlot: slot,
    });

    return {
      slot,
      fits: result.fits,
      fileCount: result.fileCount,
      totalBytes: result.totalBytes,
      perDestinationBytes: result.perDestinationBytes,
      unfitExamples: result.unfitExamples,
      unfitReason: result.unfitReason,
      unmanagedBytes: result.unmanagedBytes,
    };
  }

  status(): EmptyDiskJobState {
    const job = this.engine.status();
    return {
      slot: slotFromSourceId(job.sourceId),
      status: job.status,
      totalBytes: job.totalBytes,
      movedBytes: job.movedBytes,
      totalFiles: job.totalFiles,
      movedFiles: job.movedFiles,
      currentFile: job.currentFile,
      error: job.error,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    };
  }

  async start(slot: number): Promise<void> {
    const mounts = await this.dataDiskMountpoints();
    await this.engine.start(sourceId(slot), mounts);
  }

  cancel(): void {
    this.engine.cancel();
  }
}
