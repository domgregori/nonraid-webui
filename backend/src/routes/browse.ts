import { unlink } from 'node:fs/promises';
import os from 'node:os';
import { Router, type Response } from 'express';
import multer from 'multer';
import { suggestDirectories } from '../browse/suggest.js';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import type { BrowseService, FileProgressCallback } from '../browse/service.js';

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

// Files land in the OS temp dir first (streamed, not buffered in memory) - the
// service validates the destination and moves each one into place afterwards.
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024 * 1024 },
});

/** Browses the whole /mnt tree (see backend/src/browse/paths.ts for the
 * traversal ceiling), not one route per share - paths are absolute, passed
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

  // Directory-name completion for any host-path textbox site-wide. `scope`
  // picks which root set the caller is actually allowed to write into later -
  // "binds" (config.appsBindRoots, /mnt/user by default) for Docker/Apps bind
  // mounts, "browse" (config.browseRoot, /mnt) for anything reachable from
  // the file browser itself (backup destination, Browse page's move dialog).
  // Never a client-supplied root - only these two known-safe scopes.
  router.get('/browse/suggest', async (req, res) => {
    try {
      const roots = req.query.scope === 'binds' ? config.appsBindRoots : [config.browseRoot];
      const suggestions = await suggestDirectories(queryPath(req), roots);
      res.json({ suggestions });
    } catch (err) {
      handleError(err, res);
    }
  });

  // On-demand only (not part of list()) - a full `du` on every directory in a listing would make
  // browsing large shares painfully slow.
  router.get('/browse/size', async (req, res) => {
    try {
      res.json({ bytes: await browse.size(queryPath(req)) });
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

  router.get('/browse/read', async (req, res) => {
    try {
      res.json(await browse.readFile(queryPath(req)));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/browse/write', async (req, res) => {
    try {
      const { path: relPath, content } = req.body ?? {};
      res.json(await browse.writeFile(relPath ?? '', content ?? ''));
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

  // Streamed NDJSON, same protocol as /docker/containers etc. (see progressStream.ts on the
  // frontend) - copy/move/delete over one or more paths, reporting progress per item so a large
  // transfer doesn't read as a hung request. Cancel works by the client aborting its fetch; that
  // closes the connection, which req.on('close') below turns into a checked flag rather than
  // needing a separate cancel endpoint or a background job registry (this request stays open for
  // the operation's whole lifetime, unlike FileMoveService's detached background job).
  router.post('/browse/bulk', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
    const send = (event: object) => res.write(`${JSON.stringify(event)}\n`);

    let cancelled = false;
    req.on('close', () => {
      cancelled = true;
    });

    try {
      const { paths, op, destPath } = req.body as { paths?: unknown; op?: unknown; destPath?: unknown };
      if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string') || paths.length === 0) {
        throw new HttpError(400, 'paths must be a non-empty array of strings.');
      }
      if (op !== 'copy' && op !== 'move' && op !== 'delete') {
        throw new HttpError(400, 'op must be "copy", "move", or "delete".');
      }
      if ((op === 'copy' || op === 'move') && typeof destPath !== 'string') {
        throw new HttpError(400, 'destPath is required for copy and move.');
      }

      const succeeded: string[] = [];
      const failed: { path: string; error: string }[] = [];

      for (let i = 0; i < paths.length; i++) {
        if (cancelled) break;
        const p = paths[i] as string;
        const name = p.split('/').pop() ?? p;
        send({ type: 'progress', index: i, total: paths.length, name });
        // Sub-progress *within* this one entry - a single directory can be thousands of files,
        // long enough that the coarse "index/total" tick above sat unchanged for the entire
        // operation with nothing to show it wasn't just hung. Delete isn't included: rm() has no
        // equivalent hook the way cp() does (see browse/service.ts's throttledFilter), and deleting
        // doesn't write data the way copy/move do, so it's far less likely to look stalled anyway.
        const onFile: FileProgressCallback = (currentFile, filesDone) => send({ type: 'progress', index: i, total: paths.length, name, currentFile, filesDone });
        try {
          if (op === 'delete') await browse.remove(p);
          else if (op === 'copy') await browse.copy(p, destPath as string, onFile);
          else await browse.move(p, destPath as string, onFile);
          succeeded.push(p);
        } catch (err) {
          failed.push({ path: p, error: (err as Error).message });
        }
      }

      send({ type: 'done', result: { succeeded, failed, cancelled } });
    } catch (err) {
      send({ type: 'error', message: err instanceof HttpError ? err.message : (err as Error).message });
    } finally {
      res.end();
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
