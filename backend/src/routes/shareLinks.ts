import { Router, type Response } from 'express';
import type { ActivityStore } from '../activity/index.js';
import { HttpError } from '../httpError.js';
import type { ShareLinkService, UpdateShareLinkOptions } from '../shareLinks/index.js';
import type { ShareMode } from '../shareLinks/index.js';

function handleError(err: unknown, res: Response) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
  } else {
    res.status(502).json({ error: (err as Error).message });
  }
}

function validateMode(mode: unknown): ShareMode {
  if (mode !== 'read-only' && mode !== 'upload-only' && mode !== 'editable') {
    throw new HttpError(400, 'mode must be "read-only", "upload-only", or "editable".');
  }
  return mode;
}

// undefined = field omitted (leave as-is / use the create default); null = explicitly cleared;
// any other value must be a valid non-negative number/timestamp.
function optionalNumber(value: unknown, label: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  throw new HttpError(400, `${label} must be a non-negative number or null.`);
}

export function shareLinksRouter(shareLinks: ShareLinkService, activity: ActivityStore): Router {
  const router = Router();

  // Session-gated only, same as every other mutating route in this app (Tailscale, rclone, ...) -
  // not step-up gated. Creating a share link is scoped to one specific path (never full API/root
  // access the way an SSH key grant is), and the earlier stricter treatment made routine sharing
  // annoyingly slow for what is, day to day, an ordinary admin action.
  router.post('/share-links', async (req, res) => {
    try {
      const body = req.body ?? {};
      const mode = validateMode(body.mode);
      if (typeof body.rootPath !== 'string' || !body.rootPath.trim()) {
        res.status(400).json({ error: 'rootPath is required.' });
        return;
      }
      if (body.password !== undefined && typeof body.password !== 'string') {
        res.status(400).json({ error: 'password must be a string.' });
        return;
      }
      const created = await shareLinks.create({
        rootPath: body.rootPath,
        label: typeof body.label === 'string' ? body.label : undefined,
        mode,
        allowDelete: body.allowDelete === true,
        password: typeof body.password === 'string' && body.password ? body.password : undefined,
        uploadQuotaBytes: optionalNumber(body.uploadQuotaBytes, 'uploadQuotaBytes'),
        maxFileSizeBytes: optionalNumber(body.maxFileSizeBytes, 'maxFileSizeBytes'),
        expiresAt: optionalNumber(body.expiresAt, 'expiresAt'),
        createdBy: 'admin',
      });
      activity.log(`Share link created${created.label ? ` "${created.label}"` : ''} (${mode})`, 'green').catch(() => {});
      res.status(201).json(created);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/share-links', (_req, res) => {
    try {
      res.json(shareLinks.list());
    } catch (err) {
      handleError(err, res);
    }
  });

  // Not step-up gated: same reasoning as create() above, plus revoking (or narrowing) an
  // already-created share link is itself a "safety-positive action" the way DELETE /auth/tokens
  // is - either way, ordinary session auth is enough.
  router.patch('/share-links/:id', async (req, res) => {
    try {
      const body = req.body ?? {};
      const patch: UpdateShareLinkOptions = {};
      if (body.label !== undefined) {
        if (body.label !== null && typeof body.label !== 'string') {
          res.status(400).json({ error: 'label must be a string or null.' });
          return;
        }
        patch.label = body.label;
      }
      if (body.expiresAt !== undefined) {
        patch.expiresAt = optionalNumber(body.expiresAt, 'expiresAt');
      }
      if (body.revoked !== undefined) {
        if (typeof body.revoked !== 'boolean') {
          res.status(400).json({ error: 'revoked must be a boolean.' });
          return;
        }
        patch.revoked = body.revoked;
      }
      if (body.mode !== undefined) {
        patch.mode = validateMode(body.mode);
      }
      if (body.allowDelete !== undefined) {
        if (typeof body.allowDelete !== 'boolean') {
          res.status(400).json({ error: 'allowDelete must be a boolean.' });
          return;
        }
        patch.allowDelete = body.allowDelete;
      }
      if (body.password !== undefined) {
        if (body.password !== null && typeof body.password !== 'string') {
          res.status(400).json({ error: 'password must be a string or null.' });
          return;
        }
        patch.password = body.password;
      }
      if (body.uploadQuotaBytes !== undefined) {
        patch.uploadQuotaBytes = optionalNumber(body.uploadQuotaBytes, 'uploadQuotaBytes');
      }
      if (body.maxFileSizeBytes !== undefined) {
        patch.maxFileSizeBytes = optionalNumber(body.maxFileSizeBytes, 'maxFileSizeBytes');
      }
      const updated = await shareLinks.update(req.params.id, patch);
      if (patch.revoked !== undefined) {
        activity.log(patch.revoked ? 'Share link revoked' : 'Share link un-revoked', patch.revoked ? 'amber' : 'blue').catch(() => {});
      } else {
        activity.log(`Share link updated${updated.label ? ` "${updated.label}"` : ''}`, 'blue').catch(() => {});
      }
      res.json(updated);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/share-links/:id/activity', (req, res) => {
    try {
      res.json(shareLinks.getActivity(req.params.id));
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}
