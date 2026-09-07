import { Router, type Response } from 'express';
import { requireStepUp, totpVerifyRateLimiter, type AuthService } from '../auth/index.js';
import { HttpError } from '../httpError.js';
import type { LuksService } from '../luks/index.js';

function parseSlot(param: string): number | null {
  const slot = Number(param);
  return Number.isInteger(slot) && slot >= 0 && slot <= 29 ? slot : null;
}

function handleError(err: unknown, res: Response) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
  } else {
    res.status(502).json({ error: (err as Error).message });
  }
}

// activity logging for every LUKS mutation already lives in luks/service.ts itself (each of
// LuksService's own methods logs its own outcome) - this router never needs its own ActivityStore.
export function luksRouter(luks: LuksService, auth: AuthService): Router {
  const router = Router();

  router.get('/luks/status', async (_req, res) => {
    try {
      res.json(await luks.getStatus());
    } catch (err) {
      handleError(err, res);
    }
  });

  // Step-up gated - this both creates a brand-new passphrase-protected secret and is the one
  // action in this feature that destroys whatever was on the slot before, same reasoning
  // /ssh/keys' own POST route gates adding a new trusted key. See docs/luks-support-scope.md's
  // "Recovery" section for why recoveryPassphrase is always generated server-side and returned
  // exactly once here, never accepted from the client or persisted anywhere in plaintext.
  router.post('/disks/:slot/format-luks', totpVerifyRateLimiter, requireStepUp(auth), async (req, res) => {
    // req.params.slot types as string | undefined here (not plain string, as it does on a route
    // with only a single handler) - the extra requireStepUp middleware breaks the route string's
    // usual literal-type inference. Same `?? ''` fallback routes/ssh.ts's own step-up-gated routes
    // already use for the same reason; parseSlot() rejects '' as not a valid slot number anyway.
    const slot = parseSlot(req.params.slot ?? '');
    if (slot === null) {
      res.status(400).json({ error: 'Slot must be a number 0-29.' });
      return;
    }
    const passphrase = req.body?.passphrase;
    if (typeof passphrase !== 'string') {
      res.status(400).json({ error: 'passphrase is required.' });
      return;
    }
    try {
      // formatDiskAsLuks() itself already logs a specific "formatted as an encrypted (LUKS) XFS
      // volume" activity entry once the whole operation (format + open + recovery key slot + mkfs)
      // actually succeeds - logging a second, near-identical entry here would just double it up
      // (confirmed live: both landed in activity.json with the same timestamp).
      const result = await luks.formatDiskAsLuks(slot, passphrase);
      res.json(result);
    } catch (err) {
      handleError(err, res);
    }
  });

  // Not step-up gated - locking a disk doesn't reveal or create any secret, it's an operational
  // access-control action in the same tier as /disks/:slot/unassign, which isn't gated either.
  router.post('/luks/:slot/lock', async (req, res) => {
    const slot = parseSlot(req.params.slot);
    if (slot === null) {
      res.status(400).json({ error: 'Slot must be a number 0-29.' });
      return;
    }
    try {
      await luks.lockDisk(slot);
      res.json({ ok: true, message: `Disk ${slot} locked.` });
    } catch (err) {
      handleError(err, res);
    }
  });

  // Same reasoning as lock above: unlocking uses an already-known secret, it doesn't mint one -
  // day-to-day operational tier, not the step-up tier. `keyfileBase64` carries an admin-uploaded
  // keyfile's exact bytes for this one call only - the client base64-encodes the file client-side
  // (see src/api/luksApi.ts) rather than this route accepting a real multipart file upload, so the
  // request stays plain JSON like every other route here; either way this only ever exists as an
  // in-memory Buffer server-side (see luks/service.ts's unlockDisk()) - it's never staged to a
  // temp path, matching how a typed passphrase is handled everywhere else in this feature.
  router.post('/luks/:slot/unlock', async (req, res) => {
    const slot = parseSlot(req.params.slot);
    if (slot === null) {
      res.status(400).json({ error: 'Slot must be a number 0-29.' });
      return;
    }
    const passphrase = req.body?.passphrase;
    if (passphrase !== undefined && typeof passphrase !== 'string') {
      res.status(400).json({ error: 'passphrase must be a string if given.' });
      return;
    }
    const keyfileBase64 = req.body?.keyfileBase64;
    if (keyfileBase64 !== undefined && typeof keyfileBase64 !== 'string') {
      res.status(400).json({ error: 'keyfileBase64 must be a string if given.' });
      return;
    }
    let keyfileContents: Buffer | undefined;
    if (typeof keyfileBase64 === 'string' && keyfileBase64.length > 0) {
      keyfileContents = Buffer.from(keyfileBase64, 'base64');
      if (keyfileContents.length === 0) {
        res.status(400).json({ error: 'keyfileBase64 did not decode to any bytes.' });
        return;
      }
    }
    try {
      await luks.unlockDisk(slot, passphrase, keyfileContents);
      res.json({ ok: true, message: `Disk ${slot} unlocked.` });
    } catch (err) {
      handleError(err, res);
    }
  });

  // Step-up gated - both directions mint or remove real key material across every encrypted disk
  // at once (see docs/luks-support-scope.md's "Switching modes is a real operation" section), a
  // materially bigger blast radius than formatting a single disk.
  router.post('/luks/unlock-mode/to-stored', totpVerifyRateLimiter, requireStepUp(auth), async (req, res) => {
    const passphrase = req.body?.passphrase;
    if (typeof passphrase !== 'string') {
      res.status(400).json({ error: 'passphrase is required.' });
      return;
    }
    try {
      const result = await luks.switchToStored(passphrase);
      res.json({ ok: true, message: `Switched to stored (auto-unlock) mode for ${result.disksUpdated} disk(s).`, ...result });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/luks/unlock-mode/to-manual', totpVerifyRateLimiter, requireStepUp(auth), async (req, res) => {
    const newPassphrase = req.body?.newPassphrase;
    if (typeof newPassphrase !== 'string') {
      res.status(400).json({ error: 'newPassphrase is required.' });
      return;
    }
    try {
      const result = await luks.switchToManual(newPassphrase);
      res.json({ ok: true, message: `Switched to manual unlock mode for ${result.disksUpdated} disk(s).`, ...result });
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}
