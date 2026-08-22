import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CacheService } from '../cache/service.js';
import type { Share } from '../shares/types.js';
import { ShareService } from '../shares/service.js';
import { createFakeNmdClient } from '../test/fakeNmdClient.js';
import { createFakeShareApplier } from '../test/fakeShareApplier.js';
import { createFakeUsersClient } from '../test/fakeUsersClient.js';
import { tmpStore } from '../test/tmpStore.js';
import type { UsersClient } from './client.js';
import { UsersService } from './service.js';

function shareFixture(name: string): Share {
  return { name, disks: [1], allDisks: false, allocationMethod: 'most-free', protocols: ['smb'] };
}

const cleanups: Array<() => void> = [];

function makeServices(client: UsersClient = createFakeUsersClient()) {
  const t = tmpStore();
  cleanups.push(t.cleanup);
  const nmd = createFakeNmdClient();
  const applier = createFakeShareApplier();
  const cache = { isActiveForShares: async () => false } as unknown as CacheService;
  const shares = new ShareService(t.shareStore, applier, nmd, t.aclStore, t.activityStore, t.settingsStore, cache);
  const users = new UsersService(client, t.aclStore, t.shareStore, shares, t.activityStore);
  return { t, client, nmd, applier, shares, users, cache };
}

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups.length = 0;
});

describe('UsersService', () => {
  describe('assertManagedGroups guard', () => {
    it('creates a user whose groups are all managed', async () => {
      const { users, client, t } = makeServices();
      const create = vi.spyOn(client, 'createUser');
      const log = vi.spyOn(t.activityStore, 'log');

      const user = await users.createUser({ username: 'carol', password: 'hunter2secret', groups: ['family'] });

      expect(user.username).toBe('carol');
      expect(create).toHaveBeenCalledWith({ username: 'carol', password: 'hunter2secret', groups: ['family'] });
      expect(log).toHaveBeenCalledWith(expect.stringContaining('carol'), 'green');
    });

    it('rejects a user added to the unmanaged docker group', async () => {
      const { users, client } = makeServices();
      const create = vi.spyOn(client, 'createUser');

      await expect(users.createUser({ username: 'mallory', password: 'hunter2secret', groups: ['docker'] })).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('Unknown group(s): docker'),
      });
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects a user added to the unmanaged sudo group', async () => {
      const { users, client } = makeServices();
      const create = vi.spyOn(client, 'createUser');

      await expect(users.createUser({ username: 'mallory', password: 'hunter2secret', groups: ['sudo'] })).rejects.toMatchObject({
        status: 400,
      });
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects an update assigning an unmanaged group', async () => {
      const { users, client } = makeServices();
      const update = vi.spyOn(client, 'updateUser');

      await expect(users.updateUser('alice', { groups: ['docker'] })).rejects.toMatchObject({ status: 400 });
      expect(update).not.toHaveBeenCalled();
    });

    it('allows an update that keeps only managed groups', async () => {
      const { users, client } = makeServices();
      const update = vi.spyOn(client, 'updateUser');

      await users.updateUser('alice', { groups: ['family'] });
      expect(update).toHaveBeenCalledWith('alice', { groups: ['family'] });
    });
  });

  describe('user deletion', () => {
    it('purges the user from every share access list and resyncs exports', async () => {
      const { users, t, shares } = makeServices();
      await t.shareStore.upsert(shareFixture('media'));
      await t.shareStore.upsert(shareFixture('docs'));
      await t.aclStore.setEntry('media', 'users', 'alice', 'read-write');
      await t.aclStore.setEntry('docs', 'users', 'alice', 'read-only');
      await t.aclStore.setEntry('media', 'users', 'bob', 'hidden');
      const resync = vi.spyOn(shares, 'resyncExports');

      const result = await users.deleteUser('alice');

      expect(result.ok).toBe(true);
      expect((await t.aclStore.get('media')).users.alice).toBeUndefined();
      expect((await t.aclStore.get('docs')).users.alice).toBeUndefined();
      expect((await t.aclStore.get('media')).users.bob).toBe('hidden');
      expect(resync).toHaveBeenCalledTimes(1);
    });
  });

  describe('per-share access', () => {
    it('lists every share with permission defaulting to none', async () => {
      const { users, t } = makeServices();
      await t.shareStore.upsert(shareFixture('media'));
      await t.shareStore.upsert(shareFixture('docs'));
      await t.aclStore.setEntry('media', 'users', 'alice', 'read-only');

      const access = await users.getUserAccess('alice');

      expect(access).toEqual([
        { shareName: 'media', permission: 'read-only' },
        { shareName: 'docs', permission: 'none' },
      ]);
    });

    it('returns 404 for an unknown user', async () => {
      const { users } = makeServices();
      await expect(users.getUserAccess('ghost')).rejects.toMatchObject({ status: 404 });
    });

    it('sets a permission for a user on a share and resyncs exports', async () => {
      const { users, t, shares } = makeServices();
      await t.shareStore.upsert(shareFixture('media'));
      const resync = vi.spyOn(shares, 'resyncExports');

      await users.setUserAccess('alice', 'media', 'read-write');

      expect((await t.aclStore.get('media')).users.alice).toBe('read-write');
      expect(resync).toHaveBeenCalledTimes(1);
    });

    it('rejects an invalid permission level', async () => {
      const { users, t } = makeServices();
      await t.shareStore.upsert(shareFixture('media'));
      await expect(users.setUserAccess('alice', 'media', 'admin')).rejects.toMatchObject({ status: 400 });
    });

    it('returns 404 for an unknown share', async () => {
      const { users } = makeServices();
      await expect(users.setUserAccess('alice', 'nope', 'read-write')).rejects.toMatchObject({ status: 404 });
    });

    it('returns 404 for an unknown user', async () => {
      const { users, t } = makeServices();
      await t.shareStore.upsert(shareFixture('media'));
      await expect(users.setUserAccess('ghost', 'media', 'read-write')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('groups', () => {
    it('creates a group through the client and logs it', async () => {
      const { users, client, t } = makeServices();
      const create = vi.spyOn(client, 'createGroup');
      const log = vi.spyOn(t.activityStore, 'log');

      const group = await users.createGroup({ name: 'friends' });

      expect(group.name).toBe('friends');
      expect(create).toHaveBeenCalledWith({ name: 'friends' });
      expect(log).toHaveBeenCalledWith(expect.stringContaining('friends'), 'green');
    });

    it('deleting a group purges its access entries and resyncs exports', async () => {
      const { users, t, shares } = makeServices();
      await t.shareStore.upsert(shareFixture('media'));
      await t.aclStore.setEntry('media', 'groups', 'family', 'read-only');
      const resync = vi.spyOn(shares, 'resyncExports');

      await users.deleteGroup('family');

      expect((await t.aclStore.get('media')).groups.family).toBeUndefined();
      expect(resync).toHaveBeenCalledTimes(1);
    });

    it('lists group access with permission defaulting to none', async () => {
      const { users, t } = makeServices();
      await t.shareStore.upsert(shareFixture('media'));
      await t.aclStore.setEntry('media', 'groups', 'family', 'read-write');

      expect(await users.getGroupAccess('family')).toEqual([{ shareName: 'media', permission: 'read-write' }]);
    });

    it('returns 404 for an unknown group', async () => {
      const { users } = makeServices();
      await expect(users.getGroupAccess('nope')).rejects.toMatchObject({ status: 404 });
    });

    it('sets a permission for a group on a share', async () => {
      const { users, t } = makeServices();
      await t.shareStore.upsert(shareFixture('media'));

      await users.setGroupAccess('family', 'media', 'read-only');

      expect((await t.aclStore.get('media')).groups.family).toBe('read-only');
    });
  });

  describe('passthrough', () => {
    it('lists users straight from the client', async () => {
      const { users, client } = makeServices();
      const list = vi.spyOn(client, 'listUsers');

      const usersResult = await users.listUsers();

      expect(list).toHaveBeenCalledTimes(1);
      expect(usersResult.map((u) => u.username)).toEqual(['alice', 'bob']);
    });

    it('lists groups straight from the client', async () => {
      const { users, client } = makeServices();
      const list = vi.spyOn(client, 'listGroups');

      const groups = await users.listGroups();

      expect(list).toHaveBeenCalledTimes(1);
      expect(groups.map((g) => g.name)).toEqual(['family']);
    });
  });
});
