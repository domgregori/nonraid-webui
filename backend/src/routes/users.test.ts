import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CacheService } from '../cache/service.js';
import { ShareService } from '../shares/service.js';
import type { Share } from '../shares/types.js';
import { createFakeNmdClient } from '../test/fakeNmdClient.js';
import { createFakeShareApplier } from '../test/fakeShareApplier.js';
import { createFakeUsersClient } from '../test/fakeUsersClient.js';
import { tmpStore } from '../test/tmpStore.js';
import { UsersService } from '../users/service.js';
import { usersRouter } from './users.js';

function shareFixture(name: string): Share {
  return { name, disks: [1], allDisks: false, allocationMethod: 'most-free', protocols: ['smb'] };
}

const cleanups: Array<() => void> = [];

function makeApp() {
  const t = tmpStore();
  cleanups.push(t.cleanup);
  const nmd = createFakeNmdClient();
  const applier = createFakeShareApplier();
  const cache = { isActiveForShares: async () => false } as unknown as CacheService;
  const shares = new ShareService(t.shareStore, applier, nmd, t.aclStore, t.activityStore, t.settingsStore, cache);
  const users = new UsersService(createFakeUsersClient(), t.aclStore, t.shareStore, shares, t.activityStore);
  const app = express();
  app.use(express.json());
  app.use(usersRouter(users));
  return { app, t, shares, users };
}

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups.length = 0;
});

describe('usersRouter', () => {
  it('GET /users returns the full user list', async () => {
    const { app } = makeApp();

    const res = await request(app).get('/users');

    expect(res.status).toBe(200);
    expect(res.body.map((u: { username: string }) => u.username)).toEqual(['alice', 'bob']);
  });

  it('POST /users creates a user through the full validate->service->client cycle', async () => {
    const { app, t } = makeApp();
    const log = vi.spyOn(t.activityStore, 'log');

    const res = await request(app).post('/users').send({ username: 'carol', password: 'hunter2secret', groups: ['family'] });

    expect(res.status).toBe(201);
    expect(res.body.username).toBe('carol');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('carol'), 'green');
  });

  it('POST /users rejects an invalid username with 400', async () => {
    const { app } = makeApp();

    const res = await request(app).post('/users').send({ username: 'Bad Name', password: 'hunter2secret' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Username');
  });

  it('POST /users rejects a short password with 400', async () => {
    const { app } = makeApp();

    const res = await request(app).post('/users').send({ username: 'carol', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('at least 8 characters');
  });

  it('POST /users rejects a user added to an unmanaged group like docker', async () => {
    const { app } = makeApp();

    const res = await request(app).post('/users').send({ username: 'mallory', password: 'hunter2secret', groups: ['docker'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Unknown group(s): docker');
  });

  it('PUT /users/:username updates a user', async () => {
    const { app } = makeApp();

    const res = await request(app).put('/users/alice').send({ groups: ['family'] });

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('alice');
  });

  it('DELETE /users/:username deletes a user', async () => {
    const { app } = makeApp();

    const res = await request(app).delete('/users/alice');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /users/:username/access returns per-share permissions', async () => {
    const { app, t } = makeApp();
    await t.shareStore.upsert(shareFixture('media'));
    await t.shareStore.upsert(shareFixture('docs'));
    await t.aclStore.setEntry('media', 'users', 'alice', 'read-only');

    const res = await request(app).get('/users/alice/access');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { shareName: 'media', permission: 'read-only' },
      { shareName: 'docs', permission: 'none' },
    ]);
  });

  it('PUT /users/:username/access/:shareName sets a permission', async () => {
    const { app, t } = makeApp();
    await t.shareStore.upsert(shareFixture('media'));

    const res = await request(app).put('/users/alice/access/media').send({ permission: 'read-write' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await t.aclStore.get('media')).users.alice).toBe('read-write');
  });

  it('PUT /users/:username/access/:shareName rejects an invalid permission with 400', async () => {
    const { app, t } = makeApp();
    await t.shareStore.upsert(shareFixture('media'));

    const res = await request(app).put('/users/alice/access/media').send({ permission: 'admin' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('permission must be one of');
  });

  it('GET /groups returns the group list', async () => {
    const { app } = makeApp();

    const res = await request(app).get('/groups');

    expect(res.status).toBe(200);
    expect(res.body.map((g: { name: string }) => g.name)).toEqual(['family']);
  });

  it('POST /groups creates a group', async () => {
    const { app } = makeApp();

    const res = await request(app).post('/groups').send({ name: 'friends' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('friends');
  });

  it('POST /groups rejects an invalid group name with 400', async () => {
    const { app } = makeApp();

    const res = await request(app).post('/groups').send({ name: 'Friends!' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Group name');
  });

  it('DELETE /groups/:name deletes a group', async () => {
    const { app } = makeApp();

    const res = await request(app).delete('/groups/family');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /groups/:name/access returns group permissions', async () => {
    const { app, t } = makeApp();
    await t.shareStore.upsert(shareFixture('media'));

    const res = await request(app).get('/groups/family/access');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ shareName: 'media', permission: 'none' }]);
  });

  it('PUT /groups/:name/access/:shareName sets a group permission', async () => {
    const { app, t } = makeApp();
    await t.shareStore.upsert(shareFixture('media'));

    const res = await request(app).put('/groups/family/access/media').send({ permission: 'read-only' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await t.aclStore.get('media')).groups.family).toBe('read-only');
  });
});
