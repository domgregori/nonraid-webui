import { unlink } from 'node:fs/promises';
import os from 'node:os';
import { Router, type Response } from 'express';
import multer from 'multer';
import { HttpError } from '../httpError.js';
import type { BrowseService } from '../browse/service.js';

function handleError(err: unknown, res: Response) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
  } else {
    res.status(502).json({ error: (err as Error).message });
  }
}

function queryPath(req: { query: Record<string, unknown> }): string {
  return typeof req.query.path === 'string' ? req.query.path : '';
}

// Files land in the OS temp dir first (streamed, not buffered in memory) — the
// service validates the destination and moves each one into place afterwards.
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024 * 1024 },
});

/** Browses the whole /mnt tree (see backend/src/browse/paths.ts for the
 * traversal ceiling), not one route per share — paths are absolute, passed
 * as a `path` query/body param rather than a `:share` route segment. */
export function browseRouter(browse: BrowseService): Router {
  const router = Router();

  router.get('/browse', async (req, res) => {
    try {
      res.json(await browse.list(queryPath(req)));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/browse/download', async (req, res) => {
    try {
      const { absPath, name } = await browse.resolveDownload(queryPath(req));
      res.download(absPath, name);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/browse/mkdir', async (req, res) => {
    try {
      const { path: parentPath, name } = req.body ?? {};
      res.status(201).json(await browse.mkdir(parentPath ?? '', name));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/browse/rename', async (req, res) => {
    try {
      const { path: relPath, newName } = req.body ?? {};
      res.json(await browse.rename(relPath ?? '', newName));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/browse/move', async (req, res) => {
    try {
      const { path: relPath, destPath } = req.body ?? {};
      res.json(await browse.move(relPath ?? '', destPath ?? ''));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.delete('/browse', async (req, res) => {
    try {
      res.json(await browse.remove(queryPath(req)));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/browse/upload', upload.array('files'), async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    try {
      const destPath = typeof req.body.path === 'string' ? req.body.path : '';
      const results = [];
      for (const file of files) {
        results.push(await browse.saveUpload(destPath, file.originalname, file.path));
      }
      res.status(201).json({ ok: true, results });
    } catch (err) {
      await Promise.all(files.map((f) => unlink(f.path).catch(() => {})));
      handleError(err, res);
    }
  });

  return router;
}
