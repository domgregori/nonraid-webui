import { Router, type Response } from 'express';
import type { ActivityStore } from '../activity/index.js';
import { HttpError } from '../httpError.js';
import type { SettingsStore } from '../settings/store.js';
import { runSudoMaybe } from '../system/procUtil.js';
import type { TailscaleClient } from '../tailscale/index.js';

function handleError(err: unknown, res: Response) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
  } else {
    res.status(502).json({ error: (err as Error).message });
  }
}

export function tailscaleRouter(tailscale: TailscaleClient, settingsStore: SettingsStore, activity: ActivityStore): Router {
  const router = Router();

  router.get('/tailscale/status', async (_req, res) => {
    try {
      const [status, settings] = await Promise.all([tailscale.getStatus(), settingsStore.get()]);
      res.json({ ...status, featureEnabled: settings.tailscale.enabled, loginServer: settings.tailscale.loginServer });
    } catch (err) {
      handleError(err, res);
    }
  });

  // Separate from the generic PUT /settings, same precedent as PUT /cache/enabled: this has a real
  // side effect (starting/stopping tailscaled) beyond just persisting a preference, so it gets its
  // own endpoint rather than being folded into the generic settings patch.
  router.put('/tailscale/enabled', async (req, res) => {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean.' });
      return;
    }
    try {
      await settingsStore.update({ tailscale: { enabled } });
      // enable/disable (not just start/stop), same as every other always-wanted service this app
      // manages (see install-webui.sh's start_system_services()) - this toggle IS the "do I want
      // this on" decision for tailscaled, so it needs to survive a reboot the same way. Best-effort:
      // a host that never installed the `tailscale` package shouldn't block the toggle itself from
      // persisting (the section still needs to render its "not installed" state instead of getting
      // stuck failing to save).
      await runSudoMaybe('systemctl', [enabled ? 'enable' : 'disable', '--now', 'tailscaled']).catch(() => {});
      activity.log(`Tailscale ${enabled ? 'enabled' : 'disabled'}`, 'blue').catch(() => {});
      res.json({ ok: true, message: `Tailscale ${enabled ? 'enabled' : 'disabled'}.` });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/tailscale/login', async (req, res) => {
    const loginServer = typeof req.body?.loginServer === 'string' ? req.body.loginServer.trim() : '';
    try {
      // Remember the login-server preference for next time, whether or not this attempt succeeds -
      // a failed attempt (wrong URL, unreachable Headscale) still tells you what was tried.
      await settingsStore.update({ tailscale: { loginServer } });
      const result = await tailscale.login(loginServer || undefined);
      activity.log(result.authUrl ? 'Tailscale login started - waiting for browser authentication' : 'Tailscale connected', 'blue').catch(() => {});
      res.json(result);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/tailscale/logout', async (_req, res) => {
    try {
      await tailscale.logout();
      activity.log('Tailscale logged out', 'amber').catch(() => {});
      res.json({ ok: true, message: 'Logged out.' });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.put('/tailscale/options', async (req, res) => {
    const body = req.body ?? {};
    const options: { hostname?: string; ssh?: boolean; acceptDns?: boolean; advertiseRoutes?: string[]; acceptRoutes?: boolean } = {};
    if (body.hostname !== undefined) {
      if (typeof body.hostname !== 'string' || !body.hostname.trim()) {
        res.status(400).json({ error: 'hostname must be a non-empty string.' });
        return;
      }
      options.hostname = body.hostname.trim();
    }
    if (body.ssh !== undefined) {
      if (typeof body.ssh !== 'boolean') {
        res.status(400).json({ error: 'ssh must be a boolean.' });
        return;
      }
      options.ssh = body.ssh;
    }
    if (body.acceptDns !== undefined) {
      if (typeof body.acceptDns !== 'boolean') {
        res.status(400).json({ error: 'acceptDns must be a boolean.' });
        return;
      }
      options.acceptDns = body.acceptDns;
    }
    if (body.advertiseRoutes !== undefined) {
      if (!Array.isArray(body.advertiseRoutes) || !body.advertiseRoutes.every((r: unknown) => typeof r === 'string')) {
        res.status(400).json({ error: 'advertiseRoutes must be an array of CIDR strings.' });
        return;
      }
      options.advertiseRoutes = body.advertiseRoutes;
    }
    if (body.acceptRoutes !== undefined) {
      if (typeof body.acceptRoutes !== 'boolean') {
        res.status(400).json({ error: 'acceptRoutes must be a boolean.' });
        return;
      }
      options.acceptRoutes = body.acceptRoutes;
    }

    try {
      await tailscale.setOptions(options);
      activity.log('Tailscale settings updated', 'blue').catch(() => {});
      res.json({ ok: true, message: 'Tailscale settings updated.' });
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}
