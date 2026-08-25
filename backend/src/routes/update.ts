import { Router } from 'express';
import type { ActivityStore } from '../activity/index.js';
import { applyDriverUpdate, applyWebuiUpdate } from '../update/apply.js';
import { checkForUpdates, lastKnownUpdateStatus, type ComponentUpdateStatus, type UpdateStatus } from '../update/service.js';

const COMPONENT_LABELS = { nonraid: 'NonRAID driver', nonraidWebui: 'NonRAID WebUI' } as const;
type ComponentKey = keyof typeof COMPONENT_LABELS;

function isComponentKey(value: unknown): value is ComponentKey {
  return value === 'nonraid' || value === 'nonraidWebui';
}

export function updateRouter(activity: ActivityStore): Router {
  const router = Router();

  // Cheap, never touches the network - whatever the last check() found (or the all-null/unknown
  // shape if one has never run yet). Safe to poll on every dashboard load.
  router.get('/update/status', (_req, res) => {
    res.json(lastKnownUpdateStatus());
  });

  // Explicit "Check for updates now" - the only route that actually hits GitHub.
  router.post('/update/check', async (_req, res) => {
    const status = await checkForUpdates(true);
    res.json(status);
  });

  // Actually applies an update - see backend/src/update/apply.ts for exactly what each component
  // runs and why. Re-checks live (rather than trusting whatever the frontend last saw) so this
  // can't fire against a stale "update available" view; install-webui.sh itself is idempotent
  // either way, this is purely a "don't rebuild for nothing" UX guard.
  router.post('/update/apply', async (req, res) => {
    const component = req.body?.component;
    if (!isComponentKey(component)) {
      res.status(400).json({ error: "component must be 'nonraid' or 'nonraidWebui'" });
      return;
    }

    const status: UpdateStatus = await checkForUpdates(true);
    const target: ComponentUpdateStatus = status[component];
    if (target.upToDate !== false) {
      res.status(409).json({ error: 'No update available for this component.' });
      return;
    }

    const label = COMPONENT_LABELS[component];
    activity.log(`Applying ${label} update to ${target.latest}`, 'amber').catch(() => {});

    if (component === 'nonraid') {
      const result = await applyDriverUpdate();
      activity
        .log(
          result.ok ? `${label} updated to ${target.latest} - reload it from Settings > Services to activate.` : `${label} update failed: ${result.message}`,
          result.ok ? 'green' : 'red',
        )
        .catch(() => {});
      res.json(result);
      return;
    }

    // nonraidWebui - build+stage only (see applyWebuiUpdate's own comment on why restart_webui is
    // deliberately excluded from what it runs). On success, THIS still-running process performs
    // its own restart via the same respond-then-self-exit idiom routes/system.ts's
    // restart-services route uses, rather than letting install-webui.sh's own `systemctl restart`
    // run from inside this process's own systemd cgroup.
    const result = await applyWebuiUpdate();
    if (!result.ok) {
      activity.log(`${label} update failed: ${result.message}`, 'red').catch(() => {});
      res.json(result);
      return;
    }
    activity.log(`${label} updated to ${target.latest} - restarting now.`, 'green').catch(() => {});
    res.json({ ...result, message: 'Update applied - restarting now. This page will reconnect automatically in a few seconds.' });
    res.on('finish', () => {
      setTimeout(() => process.exit(1), 200);
    });
  });

  return router;
}
