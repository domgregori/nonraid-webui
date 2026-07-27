import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { createDockerClient } from './docker/index.js';
import { createNmdClient } from './nmd/index.js';
import { arrayRouter } from './routes/array.js';
import { disksRouter } from './routes/disks.js';
import { dockerRouter } from './routes/docker.js';
import { parityRouter } from './routes/parity.js';
import { sharesRouter } from './routes/shares.js';
import { smartRouter } from './routes/smart.js';
import { statusRouter } from './routes/status.js';
import { systemRouter } from './routes/system.js';
import { createShareApplier, ShareService, ShareStore } from './shares/index.js';
import { createSmartClient, SmartService } from './smart/index.js';
import { SystemStatsService } from './system/service.js';

function main() {
  const nmd = createNmdClient();
  const docker = createDockerClient();
  const smart = new SmartService(createSmartClient());
  const shareApplier = createShareApplier();
  const shares = new ShareService(new ShareStore(), shareApplier, nmd);
  const system = new SystemStatsService();

  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, nmdMode: nmd.mode, dockerMode: docker.mode, smartMode: smart.mode, sharesMode: shareApplier.mode });
  });

  app.use('/api', statusRouter(nmd));
  app.use('/api', arrayRouter(nmd));
  app.use('/api', parityRouter(nmd));
  app.use('/api', disksRouter(nmd));
  app.use('/api', dockerRouter(docker));
  app.use('/api', smartRouter(nmd, smart));
  app.use('/api', sharesRouter(shares));
  app.use('/api', systemRouter(system));

  app.listen(config.port, () => {
    console.log(
      `nonraid-webui backend listening on http://localhost:${config.port} ` +
        `(nmd mode: ${nmd.mode}, docker mode: ${docker.mode}, smart mode: ${smart.mode}, shares mode: ${shareApplier.mode})`,
    );
  });
}

main();
