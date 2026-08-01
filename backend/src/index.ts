import cors from 'cors';
import express from 'express';
import { ActivityStore } from './activity/index.js';
import { AppsService, CaFeedStore } from './apps/index.js';
import { BrowseService } from './browse/service.js';
import { config } from './config.js';
import { createDockerClient } from './docker/index.js';
import { createNmdClient } from './nmd/index.js';
import { activityRouter } from './routes/activity.js';
import { appsRouter } from './routes/apps.js';
import { arrayRouter } from './routes/array.js';
import { browseRouter } from './routes/browse.js';
import { disksRouter } from './routes/disks.js';
import { dockerRouter } from './routes/docker.js';
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
  const smart = new SmartService(createSmartClient());
  const activity = new ActivityStore();
  const shareApplier = createShareApplier();
  const shareStore = new ShareStore();
  const shareAccessStore = new ShareAccessStore();
  const shares = new ShareService(shareStore, shareApplier, nmd, shareAccessStore, activity);
  const browse = new BrowseService(shareStore);
  const system = new SystemStatsService();
  const usersClient = createUsersClient();
  const users = new UsersService(usersClient, shareAccessStore, shareStore, shares, activity);
  const caFeedStore = new CaFeedStore();
  await caFeedStore.start();
  const apps = new AppsService(caFeedStore, docker, activity);
  const settingsStore = new SettingsStore();

  // The driver has no readback for write method (see nmd/client.ts), so on a
  // fresh backend start (independent of whether the array/driver itself was
  // just started), reapply whatever was last persisted — best-effort, since
  // the array might not be started yet, in which case there's nothing to
  // apply until /array/start does it.
  const persistedSettings = await settingsStore.get();
  if (persistedSettings.turboWrite) {
    await nmd.setWriteMethod(true).catch(() => {});
  }

  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      nmdMode: nmd.mode,
      dockerMode: docker.mode,
      smartMode: smart.mode,
      sharesMode: shareApplier.mode,
      usersMode: usersClient.mode,
    });
  });

  app.use('/api', statusRouter(nmd));
  app.use('/api', arrayRouter(nmd, settingsStore, activity));
  app.use('/api', parityRouter(nmd, activity));
  app.use('/api', settingsRouter(settingsStore, nmd, activity));
  app.use('/api', disksRouter(nmd, activity));
  app.use('/api', dockerRouter(docker, config.appsBindRoots, apps, activity));
  app.use('/api', smartRouter(nmd, smart));
  app.use('/api', sharesRouter(shares));
  app.use('/api', browseRouter(browse));
  app.use('/api', systemRouter(system));
  app.use('/api', usersRouter(users));
  app.use('/api', appsRouter(apps));
  app.use('/api', activityRouter(activity));

  app.listen(config.port, () => {
    console.log(
      `nonraid-webui backend listening on http://localhost:${config.port} ` +
        `(nmd mode: ${nmd.mode}, docker mode: ${docker.mode}, smart mode: ${smart.mode}, shares mode: ${shareApplier.mode}, users mode: ${usersClient.mode})`,
    );
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
