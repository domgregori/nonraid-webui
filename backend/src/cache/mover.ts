import { config } from '../config.js';
import { FileMoveService } from '../fileMove/service.js';
import type { FileMoveJobState } from '../fileMove/types.js';
import { HttpError } from '../httpError.js';
import type { NmdClient } from '../nmd/index.js';
import type { SettingsStore } from '../settings/index.js';
import type { ShareStore } from '../shares/index.js';
import { isMounted } from './mount.js';

const SOURCE_ID = 'cache';

/**
 * Drains everything currently on the cache mirror onto the array, per each eligible share's own
 * allocation policy — the same FileMoveService engine EmptyDiskService uses, just sourced from
 * /mnt/cache instead of a disk being retired, and with no destSlot to exclude (cache isn't itself
 * an array slot). Unlike EmptyDiskService there's no separate user-facing "check" step: run()
 * plans and starts in one call, since the mover always moves everything, every run (see the cache
 * pool plan's scope decisions) — nothing for a user to review first.
 */
export class CacheMoverService {
  private engine = new FileMoveService();

  constructor(
    private nmd: NmdClient,
    private shareStore: ShareStore,
    private settingsStore: SettingsStore,
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

  async run(): Promise<void> {
    const settings = await this.settingsStore.get();
    if (!settings.cache.fsUuid) throw new HttpError(400, 'Cache pool is not set up.');
    if (!(await isMounted(config.cacheMountPoint))) throw new HttpError(409, 'Cache pool is not currently mounted.');

    const [mounts, shares] = await Promise.all([this.dataDiskMountpoints(), this.shareStore.list()]);
    // Mirrors RealShareApplier.usesCacheBranch()'s own single-disk exclusion — those shares never
    // write to cache in the first place, so there's nothing of theirs to drain.
    const relevantShares = shares.filter((s) => s.allocationMethod !== 'single-disk');

    const plan = await this.engine.plan({
      sourceId: SOURCE_ID,
      sourceMountpoint: config.cacheMountPoint,
      shares: relevantShares,
      destMounts: mounts,
    });
    if (!plan.fits) {
      throw new HttpError(409, plan.unfitReason ?? 'Not everything on cache currently fits on the array.');
    }

    await this.engine.start(SOURCE_ID, mounts);
  }

  status(): FileMoveJobState {
    return this.engine.status();
  }

  cancel(): void {
    this.engine.cancel();
  }
}
