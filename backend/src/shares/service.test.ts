import { mkdir, stat } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CacheService } from '../cache/service.js';
import type { NmdClient } from '../nmd/index.js';
import type { NmdStatusResponse } from '../nmd/types.js';
import { createFakeNmdClient } from '../test/fakeNmdClient.js';
import { createFakeShareApplier } from '../test/fakeShareApplier.js';
import { tmpStore } from '../test/tmpStore.js';
import type { Share } from './types.js';
import { ShareService } from './service.js';

function shareFixture(name: string, extra: Partial<Share> = {}): Share {
  return { name, disks: [1], allDisks: false, allocationMethod: 'most-free', protocols: ['smb'], ...extra };
}

function statusWithMountpoints(mountpoints: Record<number, string>): NmdStatusResponse {
  return {
    array: {
      label: 'TestArray',
      state: 'STARTED',
      superblock: '/etc/nonraid/super.dat',
      disks_present: Object.keys(mountpoints).length,
      disks_imported: Object.keys(mountpoints).length,
      disks_unassigned: 0,
      total_slots: 30,
      health: { status: 'HEALTHY', details: 'ok', code: 0 },
      size: { data_gb: 0, data_disk_count: 0, has_parity: true, has_second_parity: false, parity_size_gb: 0, second_parity_size_gb: 0 },
      counters: { missing: 0, invalid: 0, wrong: 0, disabled: 0, replaced: 0, new: 0, sync_errors: 0, disk_errors: 0 },
      last_sync: { timestamp: 0, age_seconds: 0, elapsed_seconds: 0, status: '' },
    },
    resync: { active: false, paused: false, pending: false, action: 'idle', progress_percent: 0, position_gb: 0, size_gb: 0, rate_mb_s: 0, elapsed_seconds: 0, eta_seconds: 0 },
    disks: Object.entries(mountpoints).map(([slot, mountpoint]) => ({
      slot: Number(slot),
      type: 'data',
      size_kb: 1_000_000,
      size_gb: 1000,
      device: `/dev/sd${slot}`,
      status: 'DISK_OK',
      errors: 0,
      reads: 0,
      writes: 0,
      disk_id: `DISK_${slot}`,
      disk_name: 'Test Disk',
      filesystem: { type: 'xfs', mountpoint, usage: '0%' },
    })),
  };
}

const cleanups: Array<() => void> = [];

function makeServices(nmd: NmdClient = createFakeNmdClient()) {
  const t = tmpStore();
  cleanups.push(t.cleanup);
  const applier = createFakeShareApplier();
  const cache = { isActiveForShares: async () => false } as unknown as CacheService;
  const shares = new ShareService(t.shareStore, applier, nmd, t.aclStore, t.activityStore, t.settingsStore, cache);
  return { t, nmd, applier, cache, shares };
}

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups.length = 0;
});

describe('ShareService', () => {
  describe('create', () => {
    it('mounts, persists and resyncs exports for a valid share', async () => {
      const { shares, t, applier } = makeServices();
      const mount = vi.spyOn(applier, 'mountShare');
      const sync = vi.spyOn(applier, 'syncExports');
      const log = vi.spyOn(t.activityStore, 'log');

      const created = await shares.create({ name: 'media', disks: [1], allocationMethod: 'most-free', protocols: ['smb'] });

      expect(created.name).toBe('media');
      expect(mount).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'media' }),
        expect.objectContaining({ minFreeSpaceGb: 4, cacheMountPoint: null }),
      );
      expect(await t.shareStore.get('media')).toEqual(expect.objectContaining({ name: 'media' }));
      expect(sync).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('media'), 'green');
    });

    it('sets the cache mount point in the context when the cache is active', async () => {
      const { shares, applier, cache } = makeServices();
      cache.isActiveForShares = vi.fn(async () => true);
      const mount = vi.spyOn(applier, 'mountShare');

      await shares.create({ name: 'media', disks: [1], allocationMethod: 'most-free', protocols: [] });

      expect(mount).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cacheMountPoint: '/mnt/cache' }));
    });

    it('rejects a duplicate share name', async () => {
      const { shares, t } = makeServices();
      await t.shareStore.upsert(shareFixture('media'));

      await expect(shares.create({ name: 'media', disks: [1], allocationMethod: 'most-free', protocols: ['smb'] })).rejects.toMatchObject({
        status: 409,
      });
    });

    it('rejects an invalid share input before touching the applier', async () => {
      const { shares, applier } = makeServices();
      const mount = vi.spyOn(applier, 'mountShare');

      await expect(shares.create({ name: 'bad name!', disks: [1], allocationMethod: 'most-free', protocols: ['smb'] })).rejects.toMatchObject({
        status: 400,
      });
      expect(mount).not.toHaveBeenCalled();
    });
  });

  describe('update / rename', () => {
    it('updates a share in place when the name is unchanged', async () => {
      const { shares, t, applier } = makeServices();
      await t.shareStore.upsert(shareFixture('media'));
      const mount = vi.spyOn(applier, 'mountShare');

      await shares.update('media', { name: 'media', disks: [1, 2], allocationMethod: 'high-water', protocols: ['nfs'] });

      const updated = await t.shareStore.get('media');
      expect(updated?.disks).toEqual([1, 2]);
      expect(updated?.allocationMethod).toBe('high-water');
      expect(mount).toHaveBeenCalledTimes(1);
    });

    it('returns 404 when updating a missing share', async () => {
      const { shares } = makeServices();
      await expect(shares.update('ghost', { name: 'ghost', disks: [1], allocationMethod: 'most-free', protocols: [] })).rejects.toMatchObject({
        status: 404,
      });
    });

    it('renames a share and moves its per-disk data directories', async () => {
      const base = mkdtempPath();
      const d1 = path.join(base, 'disk1');
      const d2 = path.join(base, 'disk2');
      await mkdir(path.join(d1, 'old'), { recursive: true });
      await mkdir(path.join(d2, 'old'), { recursive: true });

      const { t, shares, applier } = makeServices(createFakeNmdClient({ getStatus: async () => statusWithMountpoints({ 1: d1, 2: d2 }) }));
      await t.shareStore.upsert(shareFixture('old', { disks: [1, 2] }));
      await t.aclStore.setEntry('old', 'users', 'alice', 'read-only');
      const mount = vi.spyOn(applier, 'mountShare');

      await shares.update('old', { name: 'new', disks: [1, 2], allocationMethod: 'most-free', protocols: ['smb'] });

      await expect(stat(path.join(d1, 'new'))).resolves.toBeDefined();
      await expect(stat(path.join(d2, 'new'))).resolves.toBeDefined();
      await expect(stat(path.join(d1, 'old'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(path.join(d2, 'old'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await t.shareStore.get('new')).toBeDefined();
      expect(await t.shareStore.get('old')).toBeUndefined();
      expect((await t.aclStore.get('new')).users.alice).toBe('read-only');
      expect(mount).toHaveBeenCalledTimes(1);

      // Clean up the temporary mountpoint dirs (not tracked by the store cleanup).
      await rmDir(base);
    });

    it('refuses to rename when a disk holding the share data is offline', async () => {
      const d1 = mkdtempPath();
      await mkdir(path.join(d1, 'old'), { recursive: true });
      const { t, shares, applier } = makeServices(createFakeNmdClient({ getStatus: async () => statusWithMountpoints({ 1: d1 }) }));

      await t.shareStore.upsert(shareFixture('old', { disks: [1, 2] }));
      const unmount = vi.spyOn(applier, 'unmountShare');

      await expect(shares.update('old', { name: 'new', disks: [1, 2], allocationMethod: 'most-free', protocols: ['smb'] })).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('offline'),
      });
      expect(unmount).toHaveBeenCalledWith('old');

      await rmDir(d1);
    });

    it('refuses to rename a cache-only share while the cache pool is inactive', async () => {
      const { t, shares } = makeServices();
      await t.shareStore.upsert(shareFixture('hot', { allocationMethod: 'cache-only', disks: [] }));

      await expect(shares.update('hot', { name: 'cold', disks: [], allocationMethod: 'cache-only', protocols: [] })).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('cache pool'),
      });
    });
  });

  describe('remove', () => {
    it('unmounts, forgets and resyncs exports for an existing share', async () => {
      const { shares, t, applier } = makeServices();
      await t.shareStore.upsert(shareFixture('media'));
      await t.aclStore.setEntry('media', 'users', 'alice', 'read-write');
      const unmount = vi.spyOn(applier, 'unmountShare');
      const sync = vi.spyOn(applier, 'syncExports');

      await shares.remove('media');

      expect(unmount).toHaveBeenCalledWith('media');
      expect(await t.shareStore.get('media')).toBeUndefined();
      expect(await t.aclStore.get('media')).toEqual({ users: {}, groups: {} });
      expect(sync).toHaveBeenCalledTimes(1);
    });

    it('returns 404 when removing a missing share', async () => {
      const { shares } = makeServices();
      await expect(shares.remove('ghost')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('remountAll', () => {
    it('mounts every configured share', async () => {
      const { shares, t, applier } = makeServices();
      await t.shareStore.upsert(shareFixture('a'));
      await t.shareStore.upsert(shareFixture('b'));
      const mount = vi.spyOn(applier, 'mountShare');

      await shares.remountAll();

      expect(mount).toHaveBeenCalledTimes(2);
      expect(mount).toHaveBeenCalledWith(expect.objectContaining({ name: 'a' }), expect.anything());
      expect(mount).toHaveBeenCalledWith(expect.objectContaining({ name: 'b' }), expect.anything());
    });

    it('tolerates a per-share mount failure without throwing', async () => {
      const { shares, t, applier } = makeServices();
      await t.shareStore.upsert(shareFixture('a'));
      await t.shareStore.upsert(shareFixture('b'));
      const mount = vi
        .spyOn(applier, 'mountShare')
        .mockImplementationOnce(async () => {
          throw new Error('disk offline');
        })
        .mockImplementationOnce(async () => ({ ok: true, message: 'ok' }));

      await expect(shares.remountAll()).resolves.toBeUndefined();
      expect(mount).toHaveBeenCalledTimes(2);
    });

    it('grows allDisks shares to cover newly live disks', async () => {
      const { shares, t } = makeServices();
      await t.shareStore.upsert(shareFixture('everything', { allDisks: true, disks: [1] }));

      await shares.remountAll();

      expect((await t.shareStore.get('everything'))?.disks).toEqual([1, 2]);
    });
  });
});

function mkdtempPath(): string {
  return mkdtempSync(path.join(tmpdir(), 'shares-test-'));
}

function rmDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
