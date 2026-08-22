import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createFakeNmdClient } from '../test/fakeNmdClient.js';
import { ArrayNotConfiguredError } from '../nmd/types.js';
import { statusRouter } from './status.js';

describe('statusRouter', () => {
  it('passes through a successful getStatus as 200 JSON', async () => {
    const app = express().use(statusRouter(createFakeNmdClient()));

    const res = await request(app).get('/status');

    expect(res.status).toBe(200);
    expect(res.body.array.label).toBe('TestArray');
    expect(res.body.disks).toHaveLength(3);
  });

  it('maps ArrayNotConfiguredError to 404 with the ARRAY_NOT_CONFIGURED code', async () => {
    const nmd = createFakeNmdClient({
      getStatus: async () => {
        throw new ArrayNotConfiguredError('no array configured');
      },
    });
    const app = express().use(statusRouter(nmd));

    const res = await request(app).get('/status');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'no array configured', code: 'ARRAY_NOT_CONFIGURED' });
  });

  it('maps any other getStatus failure to 502', async () => {
    const nmd = createFakeNmdClient({
      getStatus: async () => {
        throw new Error('nmdctl blew up');
      },
    });
    const app = express().use(statusRouter(nmd));

    const res = await request(app).get('/status');

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'nmdctl blew up' });
  });
});
