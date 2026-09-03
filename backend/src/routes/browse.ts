import { unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
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

  // A folder, or several selected entries within one folder (`path` is their shared parent,
  // `names` a JSON-encoded array of their basenames - short even for a large selection, unlike
  // repeating each one's full path). Streamed straight through rather than built up server-side
  // first, so a large folder doesn't need its whole compressed size held in memory or on disk
  // before the browser even starts downloading - see BrowseService.streamArchive's own doc
  // comment for why that's a real .tar.gz stream, not a buffered one.
  router.get('/browse/download-archive', async (req, res) => {
    try {
      const namesRaw = req.query.names;
      let names: unknown[];
      try {
        names = JSON.parse(typeof namesRaw === 'string' ? namesRaw : '[]');
      } catch {
        throw new HttpError(400, 'names must be a JSON-encoded array of strings.');
      }
      const { cwd, entries, archiveName } = await browse.resolveArchiveTargets(queryPath(req), names);

      // res.attachment() (not a manual Content-Disposition header) so a name with non-ASCII
      // characters gets the RFC 5987 filename* fallback Express already knows how to build,
      // instead of a naive quoted filename that mangles anything outside plain ASCII.
      res.attachment(archiveName);
      res.setHeader('Content-Type', 'application/gzip');
      const stream = browse.streamArchive(cwd, entries);
      // Once streaming has actually started, the response's headers/status are already
      // committed - handleError's res.status().json() would be a no-op at best, an uncaught
      // "headers already sent" throw at worst. Destroying the connection is the only real option
      // left; the browser just sees a truncated/corrupt download instead of a clean error body.
      stream.on('error', (err) => res.destroy(err instanceof Error ? err : new Error(String(err))));
      stream.pipe(res);
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

  // Streamed the same way /browse/bulk is - a recursive fdfind over a real share can take a while
  // on a cold/spun-down disk, and matches trickling in as they're found reads far better than one
  // big blocking response. Capped at MAX_SEARCH_RESULTS: an unqualified query on "search
  // everywhere" (e.g. a single common letter) could otherwise match everything on the array, one
  // ndjson line at a time, for no benefit over just narrowing the query. Cancel works the same way
  // as /browse/bulk - the client aborting its fetch closes the connection, which req.on('close')
  // below turns into killing fdfind rather than needing a separate cancel endpoint.
  const MAX_SEARCH_RESULTS = 200;
  router.post('/browse/search', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
    const send = (event: object) => res.write(`${JSON.stringify(event)}\n`);

    try {
      const { path: dirPath, query, regex } = req.body as { path?: unknown; query?: unknown; regex?: unknown };
      if (typeof query !== 'string' || !query.trim()) {
        throw new HttpError(400, 'query is required.');
      }
      const root = await browse.resolveSearchRoot(typeof dirPath === 'string' ? dirPath : '');
      const child = browse.searchProcess(root, query.trim(), regex === true);
      let killedForTruncation = false;
      req.on('close', () => child.kill());

      // fdfind failing to even start (not installed, not on PATH) surfaces as an 'error' event on
      // the child itself, not as readline output - captured here rather than thrown directly since
      // it can fire either before or interleaved with the loop below reading its (empty) stdout.
      // A malformed regex (only reachable with regex:true) instead starts fine but exits non-zero
      // with a real explanation on stderr - e.g. "unclosed character class" - captured the same way
      // so that reads as a real error too, not a silent zero-result search.
      let spawnError: Error | null = null;
      let stderr = '';
      child.on('error', (err) => {
        spawnError = err;
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const exitCode = new Promise<number | null>((resolve) => child.on('close', resolve));

      const rl = readline.createInterface({ input: child.stdout });
      let count = 0;
      let truncated = false;
      for await (const line of rl) {
        if (!line) continue;
        if (count >= MAX_SEARCH_RESULTS) {
          truncated = true;
          killedForTruncation = true;
          child.kill();
          rl.close();
          break;
        }
        count++;
        // fdfind's own output already tags a directory match with a trailing "/" (confirmed live,
        // even in piped/non-tty output) - reading that is free, where determining type any other
        // way would mean a stat() per result.
        const isDirectory = line.endsWith('/');
        const absPath = isDirectory ? line.slice(0, -1) : line;
        send({ type: 'progress', match: { path: absPath, name: path.basename(absPath), type: isDirectory ? 'directory' : 'file' } });
      }

      if (spawnError) throw new Error(`fdfind failed to start: ${(spawnError as Error).message}`);
      // Only surfaced once results are exhausted, not raced against the loop above - a bad exit
      // code after truncation (this route's own kill()) is expected, not a real failure to report.
      const code = await exitCode;
      if (code !== 0 && !killedForTruncation) throw new Error(stderr.trim() || `fdfind exited with code ${code}`);
      send({ type: 'done', result: { count, truncated } });
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
