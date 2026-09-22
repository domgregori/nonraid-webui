import { createHash } from 'node:crypto';
import { copyFile, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { SandboxError } from '@nonraid/shared/path-sandbox';
import { looksBinary, MAX_EDIT_BYTES } from '@nonraid/shared/text-file-guard';
import type { ShareMode } from '@nonraid/shared/share-link-rpc';
import { config } from '../config.js';
import { parseCookies, serializeClearCookie, serializeCookie } from '../cookies.js';
import { getPathSandbox } from '../pathSandboxCache.js';
import { createRateLimiter } from '../rateLimiter.js';
import { RpcUnavailableError, type ShareLinkRpcClient } from '../shareLinkRpcClient.js';
import { ProgressDiskStorage, setUploadContext, UploadRejectedError } from '../uploadStorage.js';
import { findUnlockPayload, signUnlockCookie, unlockCookieName } from '../unlockCookie.js';

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Prefers the header Cloudflare's edge sets on every proxied request (see app.set('trust proxy',
// 'loopback') in index.ts, which is what makes req.ip itself trustworthy as a fallback for direct
// loopback testing/no-tunnel setups) - every real internet visitor otherwise looks identical
// (127.0.0.1, the tunnel's own local hop) to this process without it.
function clientIp(req: Request): string {
  const header = req.headers['cf-connecting-ip'];
  const cf = Array.isArray(header) ? header[0] : header;
  return cf || req.ip || 'unknown';
}

function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function handleUnexpected(err: unknown, res: Response): void {
  if (err instanceof RpcUnavailableError) {
    sendError(res, 503, err.message);
    return;
  }
  if (err instanceof SandboxError) {
    sendError(res, err.status, err.message);
    return;
  }
  if (err instanceof UploadRejectedError) {
    sendError(res, err.status, err.message);
    return;
  }
  console.error('Unexpected error:', err);
  sendError(res, 500, 'Internal error.');
}

function queryPath(req: Request): string {
  const p = req.query.path;
  return typeof p === 'string' ? p : '';
}

// req.params.token is always present (every route below is mounted under /api/shares/:token) -
// this just satisfies noUncheckedIndexedAccess, which can't know that from the route pattern alone.
function requireToken(req: Request): string {
  return req.params.token ?? '';
}

interface UnlockedShare {
  shareId: string;
  mode: ShareMode;
  allowDelete: boolean;
  rootPath: string;
  uploadQuotaBytes: number | null;
  maxFileSizeBytes: number | null;
  uploadUsedBytes: number;
}

/**
 * The gate every route below GET /api/shares/:token itself goes through: finds this visitor's
 * unlock cookie for this specific token (see unlockCookie.ts - no server-side session store, the
 * cookie IS the proof), then re-validates the share is still live via resolveShareForOp (subject
 * to its own short cache - see shareLinkRpcClient.ts) so a revocation/expiry takes effect
 * promptly without asking for the password again. Returns null (caller 401s) rather than throwing
 * for "not unlocked" - that's an ordinary, expected outcome here, not an error.
 */
async function requireUnlocked(req: Request, rpc: ShareLinkRpcClient, token: string): Promise<UnlockedShare | null> {
  const hash = tokenHash(token);
  const cookies = parseCookies(req.headers.cookie);
  const payload = findUnlockPayload(config.shareUnlockSecret, cookies, hash);
  if (!payload) return null;
  const resolved = await rpc.resolveShareForOp(payload.shareId);
  if (!resolved.ok) return null;
  return {
    shareId: payload.shareId,
    mode: resolved.mode,
    allowDelete: resolved.allowDelete,
    rootPath: resolved.rootPath,
    uploadQuotaBytes: resolved.uploadQuotaBytes,
    maxFileSizeBytes: resolved.maxFileSizeBytes,
    uploadUsedBytes: resolved.uploadUsedBytes,
  };
}

const DEFAULT_UPLOAD_RESERVE_BYTES = 10 * 1024 * 1024 * 1024; // 10GiB - same ceiling backend's own /browse/upload uses when nothing narrower applies

export function sharesRouter(rpc: ShareLinkRpcClient): Router {
  const router = Router();

  const unlockRateLimiter = createRateLimiter(config.loginRateLimitWindowMs, config.loginRateLimitMax, 'Too many attempts. Try again later.', (req) => `${clientIp(req)}:${req.params.token}`);
  const uploadRateLimiter = createRateLimiter(config.uploadRateLimitWindowMs, config.uploadRateLimitMax, 'Too many uploads. Slow down.', clientIp);

  // Info-only landing page data - no password check performed here beyond what a password-less
  // share's own unlockShare success (which is inherently indistinguishable from a "peek") implies.
  // Never exposes rootPath/quota - only label/mode/requiresPassword, exactly what the plan's own
  // documented contract for this route specifies.
  router.get('/api/shares/:token', async (req, res) => {
    try {
      const token = requireToken(req);
      const result = await rpc.unlockShare({ tokenHash: tokenHash(token) });
      if (!result.ok && result.reason === 'not_found') {
        sendError(res, 404, 'This share link does not exist, has expired, or was revoked.');
        return;
      }
      if (!result.ok && result.reason === 'password_required') {
        res.json({ label: result.label, mode: result.mode, requiresPassword: true });
        return;
      }
      if (result.ok) {
        // No password needed - there's no meaningful difference between "peek" and "unlock" for a
        // password-less share, so go ahead and set the cookie now rather than making the visitor
        // submit an empty form.
        setUnlockCookie(res, req, result.shareId, token);
        res.json({ label: result.label, mode: result.mode, requiresPassword: false });
        return;
      }
      sendError(res, 401, 'Incorrect password.');
    } catch (err) {
      handleUnexpected(err, res);
    }
  });

  router.post('/api/shares/:token/unlock', unlockRateLimiter, async (req, res) => {
    try {
      const token = requireToken(req);
      const password = typeof req.body?.password === 'string' ? req.body.password : undefined;
      const result = await rpc.unlockShare({ tokenHash: tokenHash(token), password });
      if (!result.ok) {
        if (result.reason === 'not_found') {
          sendError(res, 404, 'This share link does not exist, has expired, or was revoked.');
        } else {
          sendError(res, 401, 'Incorrect password.');
        }
        return;
      }
      setUnlockCookie(res, req, result.shareId, token);
      rpc.logAccess({ shareId: result.shareId, kind: 'unlock', ip: clientIp(req) });
      res.json({ ok: true, mode: result.mode, label: result.label });
    } catch (err) {
      handleUnexpected(err, res);
    }
  });

  // read-only/editable only - upload-only is a blind drop-box by design, no listing surface at
  // all, so this 404s rather than 403ing (403 would confirm "something's here, you're just not
  // allowed to see it"; 404 gives away nothing more than the token's mode already implies to
  // someone who already has the link).
  router.get('/api/shares/:token/browse', async (req, res) => {
    try {
      const share = await requireUnlocked(req, rpc, requireToken(req));
      if (!share) {
        sendError(res, 401, 'Unlock this share first.');
        return;
      }
      if (share.mode === 'upload-only') {
        sendError(res, 404, 'Not found.');
        return;
      }
      const sandbox = getPathSandbox(share.shareId, share.rootPath);
      const { absPath } = await sandbox.resolveExisting(queryPath(req));
      const st = await stat(absPath);
      if (!st.isDirectory()) {
        sendError(res, 400, 'Not a directory.');
        return;
      }
      const dirents = await readdir(absPath, { withFileTypes: true });
      const entries = await Promise.all(
        dirents.map(async (d) => {
          const entryAbsPath = path.join(absPath, d.name);
          const entryStat = await stat(entryAbsPath).catch(() => null);
          const type = d.isSymbolicLink() ? 'symlink' : d.isDirectory() ? 'directory' : 'file';
          const editable =
            share.mode === 'editable' && type === 'file' && entryStat !== null && entryStat.size <= MAX_EDIT_BYTES
              ? entryStat.size === 0 || !(await looksBinary(entryAbsPath).catch(() => true))
              : undefined;
          return {
            name: d.name,
            type,
            size: entryStat?.size ?? 0,
            modifiedAt: (entryStat?.mtime ?? new Date(0)).toISOString(),
            ...(editable !== undefined && { editable }),
          };
        }),
      );
      entries.sort((a, b) => {
        if ((a.type === 'directory') !== (b.type === 'directory')) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      rpc.logAccess({ shareId: share.shareId, kind: 'list', ip: clientIp(req), detail: queryPath(req) });
      res.json({ path: path.relative(share.rootPath, absPath) || '.', entries });
    } catch (err) {
      handleUnexpected(err, res);
    }
  });

  router.get('/api/shares/:token/download', async (req, res) => {
    try {
      const share = await requireUnlocked(req, rpc, requireToken(req));
      if (!share) {
        sendError(res, 401, 'Unlock this share first.');
        return;
      }
      if (share.mode === 'upload-only') {
        sendError(res, 404, 'Not found.');
        return;
      }
      const sandbox = getPathSandbox(share.shareId, share.rootPath);
      const { absPath } = await sandbox.resolveExisting(queryPath(req));
      const st = await stat(absPath);
      if (!st.isFile()) {
        sendError(res, 400, 'Only files can be downloaded.');
        return;
      }
      res.download(absPath, path.basename(absPath), (err) => {
        if (!err) {
          rpc.recordDownload({ shareId: share.shareId });
          rpc.logAccess({ shareId: share.shareId, kind: 'download', ip: clientIp(req), detail: path.basename(absPath) });
        }
      });
    } catch (err) {
      handleUnexpected(err, res);
    }
  });

  router.get('/api/shares/:token/read', async (req, res) => {
    try {
      const share = await requireUnlocked(req, rpc, requireToken(req));
      if (!share) {
        sendError(res, 401, 'Unlock this share first.');
        return;
      }
      if (share.mode !== 'editable') {
        sendError(res, 404, 'Not found.');
        return;
      }
      const sandbox = getPathSandbox(share.shareId, share.rootPath);
      const { absPath } = await sandbox.resolveExisting(queryPath(req));
      const st = await stat(absPath);
      if (!st.isFile()) {
        sendError(res, 400, 'Not a file.');
        return;
      }
      if (st.size > MAX_EDIT_BYTES) {
        sendError(res, 413, `File is too large to edit (${(st.size / 1024 / 1024).toFixed(1)}MB) - download it instead.`);
        return;
      }
      const buf = await readFile(absPath);
      if (buf.subarray(0, 8000).includes(0)) {
        sendError(res, 400, 'File appears to be binary, not text.');
        return;
      }
      res.json({ content: buf.toString('utf8') });
    } catch (err) {
      handleUnexpected(err, res);
    }
  });

  router.post('/api/shares/:token/write', async (req, res) => {
    try {
      const share = await requireUnlocked(req, rpc, requireToken(req));
      if (!share) {
        sendError(res, 401, 'Unlock this share first.');
        return;
      }
      if (share.mode !== 'editable') {
        sendError(res, 404, 'Not found.');
        return;
      }
      const relPath = typeof req.body?.path === 'string' ? req.body.path : '';
      const content = typeof req.body?.content === 'string' ? req.body.content : '';
      const sandbox = getPathSandbox(share.shareId, share.rootPath);
      const { absPath } = await sandbox.resolveExisting(relPath);
      const st = await stat(absPath);
      if (!st.isFile()) {
        sendError(res, 400, 'Not a file.');
        return;
      }
      // Deliberately no chown here, unlike backend/src/browse/service.ts's writeFile(): that runs
      // as root and can chown to the arrayDataOwner (uid 99); this process runs unprivileged as
      // its own dedicated account and simply cannot chown to an arbitrary uid without root. The
      // file's ownership is left exactly as it already was - only its content changes.
      await writeFile(absPath, content, 'utf8');
      rpc.recordEdit({ shareId: share.shareId, path: relPath });
      rpc.logAccess({ shareId: share.shareId, kind: 'edit', ip: clientIp(req), detail: relPath });
      res.json({ ok: true, message: `Saved "${path.basename(absPath)}"` });
    } catch (err) {
      handleUnexpected(err, res);
    }
  });

  const upload = multer({ storage: new ProgressDiskStorage() });

  router.post('/api/shares/:token/upload', uploadRateLimiter, async (req, res) => {
    try {
      const share = await requireUnlocked(req, rpc, requireToken(req));
      if (!share) {
        sendError(res, 401, 'Unlock this share first.');
        return;
      }
      if (share.mode !== 'upload-only' && share.mode !== 'editable') {
        sendError(res, 404, 'Not found.');
        return;
      }

      // No whole-request Content-Length pre-check here (there used to be one) - for a
      // multipart/form-data request, Content-Length covers the *entire body* (MIME boundaries,
      // per-part headers, filenames, ...), not any one file's own content size. Comparing that
      // total against a per-file limit rejects small, perfectly valid uploads whenever the limit
      // is anywhere near typical multipart overhead (confirmed live: a 4-byte file with a 203-byte
      // request against a 10-byte limit). The per-chunk ceiling inside ProgressDiskStorage's
      // _handleFile (see maxFileSizeBytes there) is the real, always-correct enforcement - it
      // tracks actual bytes written per file, not the request's declared total - so it alone is
      // sufficient; this route doesn't need its own approximate fast-path.
      const remainingQuota = share.uploadQuotaBytes !== null ? Math.max(0, share.uploadQuotaBytes - share.uploadUsedBytes) : null;
      const reserveHintBytes = share.maxFileSizeBytes ?? (remainingQuota !== null ? Math.min(remainingQuota, DEFAULT_UPLOAD_RESERVE_BYTES) : DEFAULT_UPLOAD_RESERVE_BYTES);

      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
      const send = (event: object) => res.write(`${JSON.stringify(event)}\n`);
      const destPath = typeof req.query.path === 'string' ? req.query.path : '';

      setUploadContext(req, {
        shareId: share.shareId,
        reserveHintBytes,
        maxFileSizeBytes: share.maxFileSizeBytes,
        rpc,
        onProgress: (name, bytesWritten) => send({ type: 'progress', name, bytesWritten }),
      });

      upload.array('files')(req, res, async (err: unknown) => {
        if (err) {
          send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
          res.end();
          return;
        }
        const files = (req.files as Express.Multer.File[] | undefined) ?? [];
        const succeeded: { name: string; size: number }[] = [];
        const failed: { name: string; error: string }[] = [];
        const sandbox = getPathSandbox(share.shareId, share.rootPath);
        for (const file of files) {
          try {
            const safeName = path.basename(file.originalname);
            const { absPath } = await sandbox.resolveForCreate(destPath, safeName);
            const exists = await stat(absPath)
              .then(() => true)
              .catch(() => false);
            if (exists) throw new Error(`"${safeName}" already exists.`);
            try {
              await rename(file.path, absPath);
            } catch {
              // Cross-device rename (EXDEV/ENOTCONN under mergerfs) - same fallback
              // backend/src/browse/service.ts's saveUpload() uses.
              await copyFile(file.path, absPath);
              await unlink(file.path).catch(() => {});
            }
            succeeded.push({ name: safeName, size: file.size });
            rpc.logAccess({ shareId: share.shareId, kind: 'upload', ip: clientIp(req), detail: safeName });
          } catch (moveErr) {
            failed.push({ name: file.originalname, error: moveErr instanceof Error ? moveErr.message : String(moveErr) });
            await unlink(file.path).catch(() => {});
          }
        }
        send({ type: 'done', result: { succeeded, failed } });
        res.end();
      });
    } catch (err) {
      handleUnexpected(err, res);
    }
  });

  return router;
}

function setUnlockCookie(res: Response, req: Request, shareId: string, token: string): void {
  const cookie = signUnlockCookie(config.shareUnlockSecret, shareId, tokenHash(token), config.unlockCookieTtlMs);
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', serializeCookie(unlockCookieName(shareId), cookie, Math.floor(config.unlockCookieTtlMs / 1000), secure));
}

// Exported for completeness/symmetry - no current route clears an unlock cookie (there's no
// "lock" action in v1), but kept here rather than left unwritten so a future one doesn't have to
// rediscover the right attributes to clear it with.
export function clearUnlockCookieHeader(req: Request, shareId: string): string {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return serializeClearCookie(unlockCookieName(shareId), secure);
}
