import { Router, type Response } from 'express';
import { HttpError } from '../httpError.js';
import type { UsersService } from '../users/index.js';

function handleError(err: unknown, res: Response) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
  } else {
    res.status(502).json({ error: (err as Error).message });
  }
}

export function usersRouter(users: UsersService): Router {
  const router = Router();

  router.get('/users', async (_req, res) => {
    try {
      res.json(await users.listUsers());
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/users', async (req, res) => {
    try {
      res.status(201).json(await users.createUser(req.body));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.put('/users/:username', async (req, res) => {
    try {
      res.json(await users.updateUser(req.params.username, req.body));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.delete('/users/:username', async (req, res) => {
    try {
      res.json(await users.deleteUser(req.params.username));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/users/:username/access', async (req, res) => {
    try {
      res.json(await users.getUserAccess(req.params.username));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.put('/users/:username/access/:shareName', async (req, res) => {
    try {
      await users.setUserAccess(req.params.username, req.params.shareName, req.body?.permission);
      res.json({ ok: true });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/groups', async (_req, res) => {
    try {
      res.json(await users.listGroups());
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/groups', async (req, res) => {
    try {
      res.status(201).json(await users.createGroup(req.body));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.delete('/groups/:name', async (req, res) => {
    try {
      res.json(await users.deleteGroup(req.params.name));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/groups/:name/access', async (req, res) => {
    try {
      res.json(await users.getGroupAccess(req.params.name));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.put('/groups/:name/access/:shareName', async (req, res) => {
    try {
      await users.setGroupAccess(req.params.name, req.params.shareName, req.body?.permission);
      res.json({ ok: true });
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}
