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

export function browseRouter(browse: BrowseService): Router {
  const router = Router();

  router.get('/browse/:share', async (req, res) => {
    try {
      res.json(await browse.list(req.params.share, queryPath(req)));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/browse/:share/download', async (req, res) => {
    try {
      const { absPath, name } = await browse.resolveDownload(req.params.share, queryPath(req));
      res.download(absPath, name);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/browse/:share/mkdir', async (req, res) => {
    try {
      const { path: parentPath, name } = req.body ?? {};
      res.status(201).json(await browse.mkdir(req.params.share, parentPath ?? '', name));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/browse/:share/rename', async (req, res) => {
    try {
      const { path: relPath, newName } = req.body ?? {};
      res.json(await browse.rename(req.params.share, relPath ?? '', newName));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/browse/:share/move', async (req, res) => {
    try {
      const { path: relPath, destPath } = req.body ?? {};
      res.json(await browse.move(req.params.share, relPath ?? '', destPath ?? ''));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.delete('/browse/:share', async (req, res) => {
    try {
      res.json(await browse.remove(req.params.share, queryPath(req)));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post<{ share: string }>('/browse/:share/upload', upload.array('files'), async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    try {
      const destPath = typeof req.body.path === 'string' ? req.body.path : '';
      const results = [];
      for (const file of files) {
        results.push(await browse.saveUpload(req.params.share, destPath, file.originalname, file.path));
      }
      res.status(201).json({ ok: true, results });
    } catch (err) {
      await Promise.all(files.map((f) => unlink(f.path).catch(() => {})));
      handleError(err, res);
    }
  });

  return router;
}
