import { Router, type Response } from 'express';
import type { ActivityStore } from '../activity/index.js';
import { requireStepUp, totpVerifyRateLimiter, type AuthService } from '../auth/index.js';
import type { CloudflaredClient } from '../cloudflared/index.js';
import { setCloudflaredToken } from '../cloudflared/index.js';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import type { SettingsStore } from '../settings/store.js';
import { runSudoMaybe } from '../system/procUtil.js';

function handleError(err: unknown, res: Response) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
  } else {
    res.status(502).json({ error: (err as Error).message });
  }
}

export function cloudflaredRouter(cloudflared: CloudflaredClient, settingsStore: SettingsStore, activity: ActivityStore, auth: AuthService): Router {
  const router = Router();

  router.get('/cloudflared/status', async (_req, res) => {
    try {
      const [status, settings] = await Promise.all([cloudflared.getStatus(), settingsStore.get()]);
      res.json({ ...status, featureEnabled: settings.cloudflared.enabled, publicUrl: settings.cloudflared.publicUrl });
    } catch (err) {
      handleError(err, res);
    }
  });

  // Same shape as PUT /tailscale/enabled: a real side effect (starting/stopping two systemd
  // units together) beyond persisting a preference, so it gets its own endpoint. Both units start
  // together - the tunnel is useless without share-server actually listening on the port it
  // forwards to, and share-server has no reason to run with no public transport in front of it.
  router.put('/cloudflared/enabled', async (req, res) => {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean.' });
      return;
    }
    try {
      await settingsStore.update({ cloudflared: { enabled } });
      const action = enabled ? 'enable' : 'disable';
      // Best-effort, same as PUT /tailscale/enabled - a host where these units aren't installed
      // yet (tools/install-webui.sh hasn't run, or hasn't been updated to install them) shouldn't
      // block the toggle itself from persisting.
      await Promise.all([
        runSudoMaybe('systemctl', [action, '--now', config.shareServerServiceName]).catch(() => {}),
        runSudoMaybe('systemctl', [action, '--now', config.cloudflaredServiceName]).catch(() => {}),
      ]);
      activity.log(`Internet file sharing ${enabled ? 'enabled' : 'disabled'} (Cloudflare Tunnel + share-server)`, 'blue').catch(() => {});
      res.json({ ok: true, message: `Internet file sharing ${enabled ? 'enabled' : 'disabled'}.` });
    } catch (err) {
      handleError(err, res);
    }
  });

  // Step-up gated - the tunnel token is a real bearer credential for whatever ingress rule the
  // Cloudflare dashboard has configured for it (equivalent in sensitivity to a trusted SSH key,
  // see POST /ssh/keys), so a valid session cookie alone isn't enough.
  router.put('/cloudflared/token', totpVerifyRateLimiter, requireStepUp(auth), async (req, res) => {
    const token = req.body?.token;
    if (typeof token !== 'string' || !token.trim()) {
      res.status(400).json({ error: 'token is required.' });
      return;
    }
    try {
      await setCloudflaredToken(token.trim());
      activity.log('Cloudflare Tunnel token updated', 'blue').catch(() => {});
      res.json({ ok: true, message: 'Tunnel token saved. Restart the tunnel service (or toggle it off/on) to apply it.' });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.put('/cloudflared/public-url', async (req, res) => {
    const publicUrl = req.body?.publicUrl;
    if (typeof publicUrl !== 'string') {
      res.status(400).json({ error: 'publicUrl must be a string.' });
      return;
    }
    try {
      await settingsStore.update({ cloudflared: { publicUrl: publicUrl.trim() } });
      res.json({ ok: true, message: 'Public URL saved.' });
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}
