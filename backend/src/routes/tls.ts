import { Router, type Response } from 'express';
import type { ActivityStore } from '../activity/index.js';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import { generateSelfSigned, suggestCommonName, suggestSans } from '../tls/certGen.js';
import type { TlsRecord, TlsStore } from '../tls/index.js';

function handleError(err: unknown, res: Response) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
  } else {
    res.status(502).json({ error: (err as Error).message });
  }
}

function originFor(scheme: 'http' | 'https', hostname: string): string {
  const isDefaultPort = (scheme === 'https' && config.port === 443) || (scheme === 'http' && config.port === 80);
  return `${scheme}://${hostname}${isDefaultPort ? '' : `:${config.port}`}`;
}

function statusPayload(record: TlsRecord | null) {
  const commonName = record?.commonName ?? suggestCommonName();
  return {
    enabled: record?.enabled ?? false,
    configured: record !== null,
    source: record?.source,
    commonName: record?.commonName,
    sans: record?.sans,
    issuedAt: record?.issuedAt,
    expiresAt: record?.expiresAt,
    suggestedCommonName: suggestCommonName(),
    suggestedSans: suggestSans(commonName),
    currentOrigin: originFor(record?.enabled ? 'https' : 'http', commonName),
  };
}

// Self-restart, exactly mirroring routes/services.ts's webui-restart branch: this backend can't
// route its own restart through `systemctl restart` (that would spawn a child inside the unit's
// own cgroup, which systemd's stop phase would kill before the start phase ever ran) — instead it
// exits non-zero and lets the unit's Restart=on-failure/RestartSec=5 bring it back with the
// newly-persisted TLS config.
function scheduleSelfRestart(res: Response): void {
  res.on('finish', () => {
    setTimeout(() => process.exit(1), 200);
  });
}

export function tlsRouter(tlsStore: TlsStore, activity: ActivityStore): Router {
  const router = Router();

  router.get('/tls/status', async (_req, res) => {
    try {
      res.json(statusPayload(await tlsStore.get()));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/tls/self-signed', async (req, res) => {
    try {
      const commonName = typeof req.body?.commonName === 'string' ? req.body.commonName : '';
      const sans = Array.isArray(req.body?.sans) ? req.body.sans.filter((s: unknown) => typeof s === 'string') : [];
      const days = typeof req.body?.days === 'number' ? req.body.days : config.tlsSelfSignedDays;
      const fields = await generateSelfSigned({ commonName, sans, days });
      await tlsStore.setCert(fields);
      activity.log(`Generated a self-signed TLS certificate for ${fields.commonName}`, 'blue').catch(() => {});
      res.json(statusPayload(await tlsStore.get()));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/tls/enable', async (_req, res) => {
    try {
      const record = await tlsStore.setEnabled(true);
      const newOrigin = originFor('https', record.commonName);
      activity.log('Enabling HTTPS — nonraid-webui is restarting', 'amber').catch(() => {});
      res.json({ ok: true, message: 'Restarting with HTTPS enabled — you will be redirected shortly.', newOrigin });
      scheduleSelfRestart(res);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/tls/disable', async (_req, res) => {
    try {
      const record = await tlsStore.setEnabled(false);
      const newOrigin = originFor('http', record.commonName);
      activity.log('Disabling HTTPS — nonraid-webui is restarting', 'amber').catch(() => {});
      res.json({ ok: true, message: 'Restarting with HTTPS disabled — you will be redirected shortly.', newOrigin });
      scheduleSelfRestart(res);
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}
