import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { ActivityStore, ActivityWatcher } from './activity/index.js';
import { AppsService, CaFeedStore } from './apps/index.js';
import { AuthService, AuthStore, requireAuth, resolveTrustProxyValue } from './auth/index.js';
import { BrowseService } from './browse/service.js';
import { CacheMoverService } from './cache/mover.js';
import { CacheMoverScheduler } from './cache/moverScheduler.js';
import { CacheService } from './cache/service.js';
import { config } from './config.js';
import { DiskQueueService } from './diskQueue/service.js';
import { createDockerClient } from './docker/index.js';
import { DockerUpdateScheduler } from './docker/updateScheduler.js';
import { EmptyDiskService } from './emptyDisk/index.js';
import { createLxcClient } from './lxc/index.js';
import { resolveLxcPath } from './lxc/storagePath.js';
import { MetricsSampler, MetricsService, openMetricsDb } from './metrics/index.js';
import { createNmdClient } from './nmd/index.js';
import { ParityScheduler } from './parity/index.js';
import { activityRouter } from './routes/activity.js';
import { appsRouter } from './routes/apps.js';
import { arrayRouter } from './routes/array.js';
import { authRouter } from './routes/auth.js';
import { browseRouter } from './routes/browse.js';
import { cacheRouter } from './routes/cache.js';
import { diskQueueRouter } from './routes/diskQueue.js';
import { disksRouter } from './routes/disks.js';
import { dockerRouter } from './routes/docker.js';
import { emptyDiskRouter } from './routes/emptyDisk.js';
import { logsRouter } from './routes/logs.js';
import { lxcRouter } from './routes/lxc.js';
import { metricsRouter } from './routes/metrics.js';
import { parityRouter } from './routes/parity.js';
import { rcloneRouter } from './routes/rclone.js';
import { servicesRouter } from './routes/services.js';
import { settingsRouter } from './routes/settings.js';
import { sharesRouter } from './routes/shares.js';
import { smartRouter } from './routes/smart.js';
import { sshRouter } from './routes/ssh.js';
import { statusRouter } from './routes/status.js';
import { systemRouter } from './routes/system.js';
import { tailscaleRouter } from './routes/tailscale.js';
import { tlsRouter } from './routes/tls.js';
import { updateRouter } from './routes/update.js';
import { UpdateScheduler } from './update/scheduler.js';
import { usersRouter } from './routes/users.js';
import { createRcloneClient } from './rclone/index.js';
import { RcloneService } from './rclone/service.js';
import { RcloneSyncScheduler } from './rclone/syncScheduler.js';
import { SettingsStore } from './settings/index.js';
import { createShareApplier, ShareAccessStore, ShareService, ShareStore } from './shares/index.js';
import { createSmartClient, SmartService } from './smart/index.js';
import { BackupScheduler } from './system/backupScheduler.js';
import { applySpinDownTimeout } from './system/hdparm.js';
import { SystemStatsService } from './system/service.js';
import { createTailscaleClient } from './tailscale/index.js';
import { TlsStore } from './tls/index.js';
import { createUsersClient, UsersService } from './users/index.js';

async function main() {
  const nmd = createNmdClient();
  const docker = createDockerClient();
  const lxc = createLxcClient();
  const smart = new SmartService(createSmartClient());
  const activity = new ActivityStore();
  const settingsStore = new SettingsStore();
  const cache = new CacheService(nmd, smart, settingsStore);
  // shares/shareStore/etc. are constructed here, ahead of their other former call site further
  // down, purely so DiskQueueService can take a real ShareService - its own add-disk flow needs
  // the same shares.unmountAll()/Docker-and-LXC-busy retry as /array/stop (see
  // system/arrayLifecycle.ts), not just the bare nmdctl stop it used to call directly.
  const shareApplier = createShareApplier();
  const shareStore = new ShareStore();
  const shareAccessStore = new ShareAccessStore();
  const shares = new ShareService(shareStore, shareApplier, nmd, shareAccessStore, activity, settingsStore, cache);
  const diskQueue = new DiskQueueService(nmd, cache, activity, shares, lxc);
  new ActivityWatcher(nmd, smart, activity, settingsStore, cache);
  new ParityScheduler(nmd, settingsStore, activity);
  const metrics = new MetricsService(openMetricsDb());
  // Constructed ahead of BackupScheduler (moved up from its former call site further down) purely
  // so BackupScheduler can take a real RcloneClient - it only ever calls reveal() on it, to turn a
  // saved (obscured) encryption password back into the plaintext an encrypted run's openssl
  // subprocess needs, same "reuse rclone's own obscure mechanism" reasoning RcloneService's own
  // password handling uses.
  const rclone = createRcloneClient();
  // Also moved up from its former call site (see UsersService below), same reasoning as rclone
  // above - BackupScheduler/RcloneService only ever call exportSnapshot()/restoreSnapshot() on the
  // raw client directly, with no need for UsersService's own share-access side effects.
  const usersClient = createUsersClient();
  const backupScheduler = new BackupScheduler(nmd, settingsStore, activity, metrics, rclone, usersClient);
  const authStore = new AuthStore();
  const authService = new AuthService(authStore);
  await authStore.get(); // fail fast at boot on a corrupt auth.json
  const tlsStore = new TlsStore();
  const tailscale = createTailscaleClient();
  const rcloneService = new RcloneService(rclone, nmd, activity, settingsStore, usersClient);
  new RcloneSyncScheduler(rcloneService, settingsStore);
  new UpdateScheduler(activity, settingsStore);
  new DockerUpdateScheduler(docker, activity, settingsStore);
  const tlsRecord = await tlsStore.get(); // fail fast at boot on a corrupt tls.json
  if (config.serveFrontend && !existsSync(path.join(config.frontendDistPath, 'index.html'))) {
    throw new Error(`serveFrontend is true but no index.html at ${config.frontendDistPath} - did the frontend build run?`);
  }
  const browse = new BrowseService(shares);
  const emptyDisk = new EmptyDiskService(nmd, shareStore);
  const cacheMover = new CacheMoverService(nmd, shareStore, settingsStore);
  new CacheMoverScheduler(cacheMover, nmd, settingsStore, activity);
  const system = new SystemStatsService(smart);
  const users = new UsersService(usersClient, shareAccessStore, shareStore, shares, activity);
  const caFeedStore = new CaFeedStore();
  await caFeedStore.start();
  const apps = new AppsService(caFeedStore, docker, activity);

  new MetricsSampler(metrics, system, nmd, smart).start();

  // The driver has no readback for write method (see nmd/client.ts), so on a
  // fresh backend start (independent of whether the array/driver itself was
  // just started), reapply whatever was last persisted - best-effort, since
  // the array might not be started yet, in which case there's nothing to
  // apply until /array/start does it.
  const persistedSettings = await settingsStore.get();
  if (persistedSettings.turboWrite) {
    await nmd.setWriteMethod(true).catch(() => {});
  }
  // hdparm -S works directly on the block device regardless of array state, unlike setWriteMethod
  // - reapply unconditionally (applySpinDownTimeout already skips disks with no real device).
  if (persistedSettings.spinDownTimeoutMinutes > 0) {
    await applySpinDownTimeout(nmd, persistedSettings.spinDownTimeoutMinutes).catch(() => {});
  }

  // Either source enables it - lets a deployment force this on via the TRUST_PROXY env var
  // without touching the UI, while still letting the UI toggle (routes/settings.ts) turn it on/off live.
  if (persistedSettings.trustProxy) {
    config.trustProxy = true;
  }

  // config.lxcDefaultPath (the -P flag every lxc-* call gets) has no other source of truth, unlike
  // Docker's own daemon.json - reapply a persisted relocation now, before anything handles a
  // request, so it survives this app's own restart (see lxc/storagePath.ts). Safe to set even
  // when mode is 'cache' before cache.remountIfConfigured() below actually mounts it - this only
  // becomes a real path once an lxc-* call runs, well after startup finishes.
  if (persistedSettings.lxcStorage.mode !== 'boot') {
    config.lxcDefaultPath = resolveLxcPath(persistedSettings.lxcStorage);
  }

  // Same "nothing survives a backend restart on its own" reasoning as the
  // share remount below - mount the cache mirror (if one's been set up)
  // before shares come back up, so a cache-aware share mount (once
  // realApplier.ts's branchPaths() knows about cache - see the cache pool
  // plan) sees it already mounted rather than racing it.
  await cache.remountIfConfigured();

  // Share mounts live in the OS mount table, not shares.json, so they don't
  // survive a backend restart/reboot on their own - reapply them now so
  // /mnt/user/<name> reflects real disk data again instead of staying an
  // empty leftover directory. Best-effort (see ShareService.remountAll):
  // never block startup on one share's mount failing.
  await shares.remountAll();

  const app = express();
  // Only set when config.trustProxy is explicitly opted into (see its doc comment in config.ts) -
  // makes req.secure/req.hostname/req.ip trust X-Forwarded-Proto/Host/For, which cookies.ts and
  // webauthn.ts rely on via requestOrigin.ts to auto-detect HTTPS behind a reverse proxy. When a
  // specific trusted proxy address is configured (Settings > Security), only requests actually
  // arriving via that address get their forwarded headers honored - address left blank falls back
  // to trusting every hop, same as before this existed. A resolution failure at boot (bad
  // hostname, DNS unavailable) falls open to blanket trust rather than crashing - same
  // "misconfiguration shouldn't brick the NAS" reasoning as the TLS cert-read fallback above.
  if (config.trustProxy) {
    try {
      app.set('trust proxy', (await resolveTrustProxyValue(persistedSettings.trustProxyAddress)) ?? true);
    } catch (err) {
      console.error(`Trusted proxy address could not be resolved (${(err as Error).message}) - trusting any hop instead. Fix it in Settings > Security.`);
      app.set('trust proxy', true);
    }
  }
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Auth routes handle their own access rules (setup/login/status/logout are
  // public by design, password-change checks the session itself) - mounted
  // before the gate below so none of them get blocked by it.
  app.use('/api', authRouter(authService, activity));

  // Production deployment shape (see tools/systemd/nonraid-webui.service):
  // this backend also serves the frontend's built static bundle and falls
  // back to index.html for client-side routes, so a logged-out browser can
  // still load the app shell (whose own JS renders the Login/Setup screen)
  // instead of getting a raw 401 on first load or on a hard refresh of a
  // route like /disks. Must stay before the requireAuth gate below for
  // exactly that reason. Both handlers are bare app.use()/app.get() with no
  // path scoping of their own, so they'd otherwise see every request
  // including ones meant for the /api/* routers mounted after the gate -
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
  app.use('/api', arrayRouter(nmd, settingsStore, activity, shares, lxc));
  app.use('/api', parityRouter(nmd, activity, settingsStore));
  app.use('/api', settingsRouter(settingsStore, nmd, activity, shares, app, rclone));
  app.use('/api', disksRouter(nmd, smart, activity, settingsStore, cache, diskQueue));
  app.use('/api', emptyDiskRouter(emptyDisk, activity));
  app.use('/api', cacheRouter(cache, cacheMover, settingsStore, activity, shares, diskQueue));
  app.use('/api', diskQueueRouter(diskQueue, nmd));
  app.use('/api', dockerRouter(docker, config.appsBindRoots, apps, activity, nmd, cache));
  app.use('/api', lxcRouter(lxc, activity, nmd, settingsStore, cache));
  app.use('/api', logsRouter(settingsStore));
  app.use('/api', metricsRouter(metrics));
  app.use('/api', smartRouter(nmd, smart, system));
  app.use('/api', sharesRouter(shares));
  app.use('/api', browseRouter(browse));
  app.use('/api', systemRouter(system, nmd, activity, backupScheduler, metrics, settingsStore, rclone, usersClient));
  app.use('/api', updateRouter(activity));
  app.use('/api', servicesRouter(activity));
  app.use('/api', sshRouter(activity, authService));
  app.use('/api', usersRouter(users));
  app.use('/api', appsRouter(apps));
  app.use('/api', activityRouter(activity));
  app.use('/api', tlsRouter(tlsStore, activity, authService));
  app.use('/api', tailscaleRouter(tailscale, settingsStore, activity));
  app.use('/api', rcloneRouter(rclone, rcloneService, settingsStore, activity));

  // Protocol is chosen once at boot from the persisted TLS config, same "config changes need a
  // restart" model as everything else in this app - see backend/src/tls/. Falls open to plain
  // HTTP (on httpPort, same as if TLS were off) if the configured cert/key can't be read, rather
  // than crashing: a bad cert combined with a crash-on-boot would brick the admin's only path back
  // into Settings to fix it (systemd would just crash-loop into the same broken tls.json forever).
  // cookieSecure/WebAuthn config is only flipped inside the success branch below - flipping it
  // unconditionally on tlsRecord.enabled would force Secure cookies even on the HTTP fallback,
  // silently breaking login (see config.ts's cookieSecure doc comment).
  let server: http.Server | https.Server = http.createServer(app);
  let listenPort = config.httpPort;
  if (tlsRecord?.enabled) {
    try {
      const [cert, key] = await Promise.all([readFile(tlsRecord.certPath, 'utf8'), readFile(tlsRecord.keyPath, 'utf8')]);
      server = https.createServer({ cert, key }, app);
      listenPort = config.httpsPort;
      config.cookieSecure = true;
      if (!config.webauthnRpId) config.webauthnRpId = tlsRecord.commonName;
      if (!config.webauthnOrigin) config.webauthnOrigin = `https://${tlsRecord.commonName}${config.httpsPort === 443 ? '' : `:${config.httpsPort}`}`;
    } catch (err) {
      console.error(
        `TLS is enabled but the cert/key at ${tlsRecord.certPath}/${tlsRecord.keyPath} could not be read (${(err as Error).message}) - falling back to plain HTTP. Fix or regenerate the certificate in Settings.`,
      );
      activity.log('TLS is enabled but the cert/key could not be read - falling back to plain HTTP', 'red').catch(() => {});
    }
  }

  server.listen(listenPort, () => {
    console.log(`nonraid-webui backend listening on ${server instanceof https.Server ? 'https' : 'http'}://localhost:${listenPort}`);
  });

  // Only once TLS actually came up (not the plain-HTTP fallback above) - httpPort's listener
  // switches roles from "the app itself" (the plain-HTTP case above) to "redirect to httpsPort",
  // a separate minimal listener whose only job is bouncing a plain http:// request over to the
  // real https:// origin. Skipped entirely if it would collide with httpsPort (both set to the
  // same custom value) - same port for both makes no sense, and would otherwise just fail to bind
  // with a less clear error.
  if (server instanceof https.Server && config.httpPort !== config.httpsPort) {
    const portSuffix = config.httpsPort === 443 ? '' : `:${config.httpsPort}`;
    const redirectServer = http.createServer((req, res) => {
      const hostname = (req.headers.host ?? '').split(':')[0] || 'localhost';
      res.writeHead(301, { Location: `https://${hostname}${portSuffix}${req.url ?? '/'}` });
      res.end();
    });
    redirectServer.on('error', (err) => {
      console.error(`HTTP->HTTPS redirect listener could not bind on port ${config.httpPort} (${err.message}) - continuing without it.`);
    });
    redirectServer.listen(config.httpPort, () => {
      console.log(`HTTP->HTTPS redirect listening on http://localhost:${config.httpPort}`);
    });
  }
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
