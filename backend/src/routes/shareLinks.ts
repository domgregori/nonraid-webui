import { Router, type Response } from 'express';
import type { ActivityStore } from '../activity/index.js';
import { requireStepUp, totpVerifyRateLimiter, type AuthService } from '../auth/index.js';
import { HttpError } from '../httpError.js';
import type { ShareLinkService } from '../shareLinks/index.js';
import type { ShareMode, UpdateShareLinkInput } from '../shareLinks/index.js';

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

export function shareLinksRouter(shareLinks: ShareLinkService, activity: ActivityStore, auth: AuthService): Router {
  const router = Router();

  // Step-up gated the same way POST /ssh/keys is: once a Cloudflare Tunnel is enabled, a share
  // link is real, internet-reachable access to array data - a valid session cookie alone isn't
  // enough (someone at an unlocked, already-logged-in browser shouldn't be able to silently mint
  // one). Rate-limited the same way every other TOTP re-check is.
  router.post('/share-links', totpVerifyRateLimiter, requireStepUp(auth), async (req, res) => {
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

  // Not step-up gated: revoking (or editing the label/expiry of) an already-created share link
  // only ever narrows access, same "safety-positive action" reasoning DELETE /auth/tokens gets.
  router.patch('/share-links/:id', (req, res) => {
    try {
      const body = req.body ?? {};
      const patch: UpdateShareLinkInput = {};
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
      const updated = shareLinks.update(req.params.id, patch);
      if (patch.revoked !== undefined) {
        activity.log(patch.revoked ? 'Share link revoked' : 'Share link un-revoked', patch.revoked ? 'amber' : 'blue').catch(() => {});
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
