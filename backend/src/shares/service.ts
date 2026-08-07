import { rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ActivityStore } from '../activity/index.js';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import type { NmdClient } from '../nmd/index.js';
import type { SettingsStore } from '../settings/index.js';
import type { ShareAccessStore } from './aclStore.js';
import type { ApplyContext, ShareApplier } from './applier/client.js';
import type { ShareStore } from './store.js';
import type { Share, ShareWithStats } from './types.js';
import { validateShareInput } from './validate.js';

export class ShareService {
  constructor(
    private store: ShareStore,
    private applier: ShareApplier,
    private nmd: NmdClient,
    private aclStore: ShareAccessStore,
    private activity: ActivityStore,
    private settingsStore: SettingsStore,
  ) {}

  private async buildContext(): Promise<ApplyContext> {
    const [status, settings] = await Promise.all([this.nmd.getStatus(), this.settingsStore.get()]);
    const diskMountpoints: Record<number, string> = {};

    for (const d of status.disks) {
      if (d.type !== 'data') continue;
      const mp = d.filesystem?.mountpoint;
      if (mp && mp !== '-') diskMountpoints[d.slot] = mp;
    }

    return { diskMountpoints, minFreeSpaceMb: settings.minFreeSpaceMb };
  }

  /**
   * Re-mounts every configured share. Mount state lives in the OS (mount
   * table), not in shares.json, so it doesn't survive a backend restart or
   * host reboot on its own — call this once at startup so /mnt/user/<name>
   * reflects real disk data again instead of staying an empty leftover
   * directory from before the restart. Best-effort per share: one share
   * with an offline disk shouldn't block the others (or startup) from
   * mounting.
   *
   * Also the natural checkpoint for growing `allDisks` shares: this runs
   * after every operation that can change which disks are actually live
   * (array start, shrink, reload-driver, backend startup) — see
   * growAllDisksShares()'s own doc comment for why growth belongs here
   * rather than hooked directly off Add/Replace Disk.
   */
  async remountAll(): Promise<void> {
    const [shares, ctx] = await Promise.all([this.store.list(), this.buildContext()]);
    const grown = await this.growAllDisksShares(shares, ctx);
    for (const share of grown) {
      try {
        await this.applier.mountShare(share, ctx);
      } catch (err) {
        console.error(`Failed to remount share "${share.name}" at startup:`, (err as Error).message);
      }
    }
  }

  /**
   * For every share configured with `allDisks: true`, adds any currently-live
   * data disk it doesn't already cover — never removes one, so a disk taken
   * offline or dropped via Shrink Array doesn't silently disappear from a
   * share's config out from under it; that stays an explicit, deliberate
   * action. Persists each change before returning so the growth survives even
   * if the mount attempt right after this fails, and so GET /shares reflects
   * it immediately.
   *
   * Hooked into remountAll() rather than directly off Add/Replace Disk
   * because those two endpoints only commit the disk at the driver level —
   * they don't mount its filesystem (see /array/start's own comment on why
   * that's a separate step) — so at the moment a disk is added there's no
   * mountpoint yet to add it with. By the time remountAll() actually runs
   * next (the user hits Start Array, same as for any newly added disk today),
   * ctx has a real mountpoint for it.
   */
  private async growAllDisksShares(shares: Share[], ctx: ApplyContext): Promise<Share[]> {
    const liveSlots = Object.keys(ctx.diskMountpoints).map(Number);
    const result: Share[] = [];
    for (const share of shares) {
      if (!share.allDisks) {
        result.push(share);
        continue;
      }
      const missing = liveSlots.filter((slot) => !share.disks.includes(slot));
      if (missing.length === 0) {
        result.push(share);
        continue;
      }
      const updated: Share = { ...share, disks: [...share.disks, ...missing].sort((a, b) => a - b) };
      await this.store.upsert(updated);
      this.activity.log(`Share "${share.name}" extended to new disk(s) ${missing.join(', ')}`, 'blue').catch(() => {});
      result.push(updated);
    }
    return result;
  }

  /**
   * Unmounts every configured share. Needed before the array can stop:
   * nmdctl (always run with -u here) refuses outright to stop with any disk
   * filesystem still mounted, and a share's mergerfs/bind mount holds a live
   * reference into those disk mounts even after nmdctl tries to unmount them
   * itself — nmdctl has no idea this app's share layer exists. Unlike
   * remountAll(), NOT best-effort: if a share is genuinely busy (a file
   * still open), the caller needs to know rather than silently proceeding
   * into a stop that would just fail anyway with a less useful error.
   */
  async unmountAll(): Promise<void> {
    const shares = await this.store.list();
    const failures: string[] = [];
    for (const share of shares) {
      try {
        await this.applier.unmountShare(share.name);
      } catch (err) {
        failures.push(`${share.name}: ${(err as Error).message}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`Failed to unmount share(s): ${failures.join('; ')}`);
    }
  }

  /**
   * If `mountPath` is exactly a configured share's own mount point
   * (config.shareMountRoot + "/" + name), permanently deletes that share:
   * unmounts it, removes the real underlying data from every disk backing
   * it (not just the merged view — the OS refuses to rmdir a mount point
   * while it's active, EBUSY, so Browse can't just delete it like a normal
   * directory), and drops it from the share list so a later remountAll()
   * doesn't bring the empty mount point back. Returns the removed share's
   * name, or null if `mountPath` isn't a share's mount point (nothing to
   * do here — the caller should fall back to a normal filesystem delete).
   *
   * This is irreversible — unlike `remove()` (used by the Shares page),
   * which only forgets the share config and leaves real files intact, this
   * also wipes the data itself. Used by Browse's delete, where "delete this
   * folder" means exactly that, mount point or not.
   */
  async removeMountPointWithData(mountPath: string): Promise<string | null> {
    if (path.dirname(mountPath) !== config.shareMountRoot) return null;
    const name = path.basename(mountPath);
    const share = await this.store.get(name);
    if (!share) return null;

    const ctx = await this.buildContext();
    await this.applier.unmountShare(name);
    for (const slot of share.disks) {
      const mp = ctx.diskMountpoints[slot];
      if (!mp) continue; // disk offline — nothing reachable to delete on it
      await rm(`${mp}/${name}`, { recursive: true, force: true });
    }
    // Now just a plain empty directory (unmounted), so this won't hit the
    // EBUSY that stopped a direct delete in the first place. Best-effort:
    // the share is already fully gone by this point either way.
    await rm(mountPath, { recursive: true, force: true }).catch(() => {});

    await this.store.remove(name);
    await this.aclStore.removeShare(name);
    await this.resyncExports();
    this.activity.log(`Share "${name}" deleted, including its data`, 'red').catch(() => {});
    return name;
  }

  async list(): Promise<ShareWithStats[]> {
    const [shares, ctx] = await Promise.all([this.store.list(), this.buildContext()]);
    return Promise.all(shares.map(async (s) => ({ ...s, stats: await this.applier.getStats(s, ctx) })));
  }

  async create(input: unknown): Promise<Share> {
    const share = validateShareInput(input);
    if (await this.store.get(share.name)) {
      throw new HttpError(409, `Share "${share.name}" already exists.`);
    }

    const ctx = await this.buildContext();
    await this.applier.mountShare(share, ctx);
    await this.store.upsert(share);
    await this.resyncExports();
    this.activity.log(`Share "${share.name}" created`, 'green').catch(() => {});
    return share;
  }

  async update(name: string, input: unknown): Promise<Share> {
    const existing = await this.store.get(name);
    if (!existing) {
      throw new HttpError(404, `Share "${name}" not found.`);
    }
    const share = validateShareInput(input);
    const ctx = await this.buildContext();
    const renamed = share.name !== name;

    if (renamed) {
      if (await this.store.get(share.name)) {
        throw new HttpError(409, `Share "${share.name}" already exists.`);
      }
      await this.applier.unmountShare(name);
      // mountShare() only ever creates a fresh, empty directory for whatever
      // name it's given — it has no idea a same-data directory under the old
      // name exists. Without this, a rename would silently orphan every real
      // file on disk: still present, but invisible through the renamed
      // share's mount and effectively unreachable to anyone who doesn't know
      // to go hunting through /mnt/diskN/<old-name> directly. Uses the
      // *old* share's own disk list — the data lives wherever it was
      // actually assigned before, not wherever the new config points.
      await this.moveShareData(existing, share.name, ctx);
      await this.store.remove(name);
      await this.renameAccess(name, share.name);
    }

    await this.applier.mountShare(share, ctx);
    await this.store.upsert(share);
    await this.resyncExports();
    this.activity.log(renamed ? `Share "${name}" renamed to "${share.name}"` : `Share "${share.name}" updated`, 'blue').catch(() => {});
    return share;
  }

  async remove(name: string): Promise<void> {
    if (!(await this.store.get(name))) {
      throw new HttpError(404, `Share "${name}" not found.`);
    }
    await this.applier.unmountShare(name);
    await this.store.remove(name);
    await this.aclStore.removeShare(name);
    await this.resyncExports();
    this.activity.log(`Share "${name}" deleted`, 'red').catch(() => {});
  }

  /** Re-derives smb.conf/exports from the current share list + access lists. Also
   *  used by UsersService after any user/group/access change, since those affect
   *  the same generated config without changing the share list itself. */
  async resyncExports(): Promise<void> {
    await this.applier.syncExports(await this.store.list(), await this.aclStore.getAll());
  }

  private async renameAccess(oldName: string, newName: string): Promise<void> {
    const access = await this.aclStore.get(oldName);
    await this.aclStore.removeShare(oldName);
    for (const [user, perm] of Object.entries(access.users)) await this.aclStore.setEntry(newName, 'users', user, perm);
    for (const [group, perm] of Object.entries(access.groups)) await this.aclStore.setEntry(newName, 'groups', group, perm);
  }

  /**
   * Moves a share's real per-disk directories from its old name to its new
   * one, on every disk it was actually assigned to before the rename (not
   * wherever the new config points — a rename can change disks in the same
   * call). Refuses the whole rename if any of those disks is currently
   * offline, rather than proceeding partially — going ahead anyway would
   * strand that disk's data under the old name, unreachable through the
   * renamed share, until someone happens to notice and fix it up by hand.
   * A disk with no old-named directory (nothing was ever written there) is
   * a normal no-op, not an error.
   */
  private async moveShareData(oldShare: Share, newName: string, ctx: ApplyContext): Promise<void> {
    const skipped: number[] = [];
    for (const slot of oldShare.disks) {
      const mountpoint = ctx.diskMountpoints[slot];
      if (!mountpoint) {
        skipped.push(slot);
        continue;
      }
      const oldPath = `${mountpoint}/${oldShare.name}`;
      const newPath = `${mountpoint}/${newName}`;
      const exists = await stat(oldPath).then(() => true, () => false);
      if (!exists) continue;
      await rename(oldPath, newPath);
    }
    if (skipped.length > 0) {
      throw new HttpError(
        409,
        `Slot(s) ${skipped.join(', ')} are offline — their data under "${oldShare.name}" can't be moved right now. Bring them back online before renaming, or the data would be stranded under the old name.`,
      );
    }
  }
}
