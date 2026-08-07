import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ActivityStore, ActivityWatcher } from './activity/index.js';
import { AppsService, CaFeedStore } from './apps/index.js';
import { AuthService, AuthStore, requireAuth } from './auth/index.js';
import { BrowseService } from './browse/service.js';
import { config } from './config.js';
import { createDockerClient } from './docker/index.js';
import { EmptyDiskService } from './emptyDisk/index.js';
import { createLxcClient } from './lxc/index.js';
import { MetricsSampler, MetricsService, openMetricsDb } from './metrics/index.js';
import { createNmdClient } from './nmd/index.js';
import { activityRouter } from './routes/activity.js';
import { appsRouter } from './routes/apps.js';
import { arrayRouter } from './routes/array.js';
import { authRouter } from './routes/auth.js';
import { browseRouter } from './routes/browse.js';
import { disksRouter } from './routes/disks.js';
import { dockerRouter } from './routes/docker.js';
import { emptyDiskRouter } from './routes/emptyDisk.js';
import { lxcRouter } from './routes/lxc.js';
import { metricsRouter } from './routes/metrics.js';
import { parityRouter } from './routes/parity.js';
import { settingsRouter } from './routes/settings.js';
import { sharesRouter } from './routes/shares.js';
import { smartRouter } from './routes/smart.js';
import { statusRouter } from './routes/status.js';
import { systemRouter } from './routes/system.js';
import { usersRouter } from './routes/users.js';
import { SettingsStore } from './settings/index.js';
import { createShareApplier, ShareAccessStore, ShareService, ShareStore } from './shares/index.js';
import { createSmartClient, SmartService } from './smart/index.js';
import { SystemStatsService } from './system/service.js';
import { createUsersClient, UsersService } from './users/index.js';

async function main() {
  const nmd = createNmdClient();
  const docker = createDockerClient();
  const lxc = createLxcClient();
  const smart = new SmartService(createSmartClient());
  const activity = new ActivityStore();
  new ActivityWatcher(nmd, smart, activity);
  const authStore = new AuthStore();
  const authService = new AuthService(authStore);
  await authStore.get(); // fail fast at boot on a corrupt auth.json
  if (config.serveFrontend && !existsSync(path.join(config.frontendDistPath, 'index.html'))) {
    throw new Error(`serveFrontend is true but no index.html at ${config.frontendDistPath} — did the frontend build run?`);
  }
  const settingsStore = new SettingsStore();
  const shareApplier = createShareApplier();
  const shareStore = new ShareStore();
  const shareAccessStore = new ShareAccessStore();
  const shares = new ShareService(shareStore, shareApplier, nmd, shareAccessStore, activity, settingsStore);
  const browse = new BrowseService(shares);
  const emptyDisk = new EmptyDiskService(nmd, shareStore);
  const system = new SystemStatsService(smart);
  const usersClient = createUsersClient();
  const users = new UsersService(usersClient, shareAccessStore, shareStore, shares, activity);
  const caFeedStore = new CaFeedStore();
  await caFeedStore.start();
  const apps = new AppsService(caFeedStore, docker, activity);

  const metrics = new MetricsService(openMetricsDb());
  new MetricsSampler(metrics, system, nmd, smart).start();

  // The driver has no readback for write method (see nmd/client.ts), so on a
  // fresh backend start (independent of whether the array/driver itself was
  // just started), reapply whatever was last persisted — best-effort, since
  // the array might not be started yet, in which case there's nothing to
  // apply until /array/start does it.
  const persistedSettings = await settingsStore.get();
  if (persistedSettings.turboWrite) {
    await nmd.setWriteMethod(true).catch(() => {});
  }

  // Share mounts live in the OS mount table, not shares.json, so they don't
  // survive a backend restart/reboot on their own — reapply them now so
  // /mnt/user/<name> reflects real disk data again instead of staying an
  // empty leftover directory. Best-effort (see ShareService.remountAll):
  // never block startup on one share's mount failing.
  await shares.remountAll();

  const app = express();
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Auth routes handle their own access rules (setup/login/status/logout are
  // public by design, password-change checks the session itself) — mounted
  // before the gate below so none of them get blocked by it.
  app.use('/api', authRouter(authService));

  // Production deployment shape (see tools/systemd/nonraid-webui.service):
  // this backend also serves the frontend's built static bundle and falls
  // back to index.html for client-side routes, so a logged-out browser can
  // still load the app shell (whose own JS renders the Login/Setup screen)
  // instead of getting a raw 401 on first load or on a hard refresh of a
  // route like /disks. Must stay before the requireAuth gate below for
  // exactly that reason. Both handlers are bare app.use()/app.get() with no
  // path scoping of their own, so they'd otherwise see every request
  // including ones meant for the /api/* routers mounted after the gate —
  // isApiPath keeps this scoped to non-API paths only. Relies on
  // express.static's default { fallthrough: true }; if that's ever
  // overridden, a missing static file 404s directly instead of falling
  // through to the SPA route below.
  if (config.serveFrontend) {
    const isApiPath = (req: express.Request): boolean => req.path === '/api' || req.path.startsWith('/api/');
    app.use((req, res, next) => {
      if (isApiPath(req)) return next();
      express.static(config.frontendDistPath)(req, res, next);
    });
    app.get('*', (req, res, next) => {
      if (isApiPath(req)) return next();
      res.sendFile(path.join(config.frontendDistPath, 'index.html'));
    });
  }

  // Everything mounted after this point requires a valid session.
  app.use(requireAuth(authService));

  app.use('/api', statusRouter(nmd));
  app.use('/api', arrayRouter(nmd, settingsStore, activity, shares));
  app.use('/api', parityRouter(nmd, activity));
  app.use('/api', settingsRouter(settingsStore, nmd, activity, shares));
  app.use('/api', disksRouter(nmd, smart, activity));
  app.use('/api', emptyDiskRouter(emptyDisk, activity));
  app.use('/api', dockerRouter(docker, config.appsBindRoots, apps, activity));
  app.use('/api', lxcRouter(lxc, activity));
  app.use('/api', metricsRouter(metrics));
  app.use('/api', smartRouter(nmd, smart));
  app.use('/api', sharesRouter(shares));
  app.use('/api', browseRouter(browse));
  app.use('/api', systemRouter(system));
  app.use('/api', usersRouter(users));
  app.use('/api', appsRouter(apps));
  app.use('/api', activityRouter(activity));

  app.listen(config.port, () => {
    console.log(`nonraid-webui backend listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
