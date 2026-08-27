import { Router, type Response } from 'express';
import type { ActivityStore } from '../activity/index.js';
import { requireStepUp, totpVerifyRateLimiter, type AuthService } from '../auth/index.js';
import { HttpError } from '../httpError.js';
import { isSshEnabled, setSshEnabled } from '../system/services.js';
import { addAuthorizedKey, listAuthorizedKeys, removeAuthorizedKey, type SshKeyEntry } from '../system/sshKeys.js';

function handleError(err: unknown, res: Response) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
  } else {
    res.status(502).json({ error: (err as Error).message });
  }
}

// Never echoes SshKeyEntry.raw - the fingerprint is enough for the UI to tell entries apart and
// target one for removal, no reason to send a full public key back over the wire.
const toPublicEntry = ({ type, comment, fingerprint }: SshKeyEntry) => ({ type, comment, fingerprint });

export function sshRouter(activity: ActivityStore, auth: AuthService): Router {
  const router = Router();

  router.get('/ssh/status', async (_req, res) => {
    try {
      const [enabled, keys] = await Promise.all([isSshEnabled(), listAuthorizedKeys()]);
      res.json({ enabled, keys: keys.map(toPublicEntry) });
    } catch (err) {
      handleError(err, res);
    }
  });

  // Separate from the generic PUT /settings, same precedent as PUT /tailscale/enabled: this has a
  // real side effect (systemctl enable/disable) beyond persisting a preference. Unlike Tailscale,
  // there's no settings.json flag to write here at all - systemd is already the only source of
  // truth for "enabled" (see services.ts's isSshEnabled/setSshEnabled doc comment).
  router.put('/ssh/enabled', async (req, res) => {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean.' });
      return;
    }
    try {
      await setSshEnabled(enabled);
      activity.log(`SSH ${enabled ? 'enabled at boot' : 'disabled at boot'}`, enabled ? 'blue' : 'amber').catch(() => {});
      res.json({ ok: true, message: `SSH ${enabled ? 'enabled' : 'disabled'}.` });
    } catch (err) {
      handleError(err, res);
    }
  });

  // Step-up gated - adding a trusted key grants full root shell access, so a valid session cookie
  // alone isn't enough (someone at an unlocked, already-logged-in browser shouldn't be able to
  // silently add their own persistent backdoor). requireStepUp is the reusable gate for this (see
  // its own doc comment) - any future sensitive mutation can drop the same middleware in rather
  // than re-implementing the password(+2FA) check inline. Rate-limited the same way session-gated
  // TOTP re-checks already are (totpVerifyRateLimiter's own doc comment) - a 6-digit code is
  // brute-forceable without it.
  router.post('/ssh/keys', totpVerifyRateLimiter, requireStepUp(auth), async (req, res) => {
    const key = req.body?.key;
    if (typeof key !== 'string' || !key.trim()) {
      res.status(400).json({ error: 'key is required.' });
      return;
    }
    try {
      await addAuthorizedKey(key);
      activity.log('SSH key added', 'blue').catch(() => {});
      const keys = await listAuthorizedKeys();
      res.json({ ok: true, keys: keys.map(toPublicEntry) });
    } catch (err) {
      handleError(err, res);
    }
  });

  // Step-up gated the same way adding one is - removing the wrong key (or having one removed by
  // someone at an unlocked session) is just as much a real access-control change as adding a
  // rogue one, so this gets the same re-confirmation rather than the lighter no-re-auth treatment
  // RemovePasskeyDialog.tsx uses for passkeys (removing one of several 2FA factors is lower-stakes
  // than losing SSH access entirely, especially if this was the only trusted key).
  router.delete('/ssh/keys/:fingerprint', totpVerifyRateLimiter, requireStepUp(auth), async (req, res) => {
    try {
      await removeAuthorizedKey(req.params.fingerprint ?? '');
      activity.log('SSH key removed', 'amber').catch(() => {});
      const keys = await listAuthorizedKeys();
      res.json({ ok: true, keys: keys.map(toPublicEntry) });
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}
