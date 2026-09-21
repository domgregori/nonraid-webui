import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { sharesRouter } from './routes/shares.js';
import { ShareLinkRpcClient } from './shareLinkRpcClient.js';

async function main() {
  if (config.shareUnlockSecretIsEphemeral) {
    console.error(
      'SHARE_UNLOCK_SECRET is not set - using a random secret generated for this process only. ' +
        'Every visitor unlock cookie will be invalidated on the next restart. Set SHARE_UNLOCK_SECRET ' +
        '(tools/install-webui.sh does this automatically in a real install) to fix this.',
    );
  }

  const rpc = new ShareLinkRpcClient();
  rpc.connect();

  const app = express();
  // Cloudflare Tunnel always connects to this process over loopback (127.0.0.1) regardless of
  // where the real visitor is - trusting X-Forwarded-* from that one hop is what makes req.ip
  // itself meaningful as a fallback below, the same "narrow, single trusted hop" reasoning the
  // admin backend's own trustProxyAddress setting uses, just hardcoded here since there is only
  // ever one legitimate topology for this process (nothing else should ever proxy to it).
  app.set('trust proxy', 'loopback');
  // Only matters for local dev (public-share's own Vite dev server on a different origin/port);
  // the production deployment shape serves both from this same origin (see the static block
  // below), where CORS is a no-op.
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, rpcConnected: rpc.isConnected });
  });

  app.use(sharesRouter(rpc));

  // Static + SPA-fallback for the built public-share bundle - scoped to skip /api/* so a request
  // for a route this process doesn't actually have (see the isApiPath check) falls through to a
  // genuine 404 rather than being swallowed by index.html, which is exactly what the "admin API is
  // structurally unreachable via the public port" verification step below depends on.
  if (config.serveFrontend) {
    const distIndex = path.join(config.publicShareDistPath, 'index.html');
    if (existsSync(distIndex)) {
      const isApiPath = (p: string) => p === '/api' || p.startsWith('/api/');
      app.use((req, res, next) => {
        if (isApiPath(req.path)) return next();
        express.static(config.publicShareDistPath)(req, res, next);
      });
      app.get('*', (req, res, next) => {
        if (isApiPath(req.path)) return next();
        res.sendFile(distIndex);
      });
    } else {
      console.error(`SERVE_PUBLIC_SHARE_FRONTEND is true but no index.html at ${distIndex} - did the public-share frontend build run? Serving API routes only.`);
    }
  }

  // Anything reaching here is either /api/* with no matching route, or the frontend intentionally
  // disabled - a genuine 404, never a fallback to anything resembling the admin app.
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.listen(config.port, config.host, () => {
    console.log(`share-server listening on http://${config.host}:${config.port}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
