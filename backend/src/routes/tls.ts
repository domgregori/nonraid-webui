import { randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Router, type Response } from 'express';
import multer from 'multer';
import type { ActivityStore } from '../activity/index.js';
import type { AuthService } from '../auth/index.js';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import { generateSelfSigned, suggestCommonName, suggestSans } from '../tls/certGen.js';
import { checkKeyMatchesCert, parseCertInfo } from '../tls/certInspect.js';
import type { TlsRecord, TlsStore } from '../tls/index.js';

// PEM cert/key files are typically a few KB each — 64KB/file is generous headroom, same limit
// array.ts's import flow uses for its own fixed-size upload.
const importUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 64 * 1024 } });

interface StagedTlsImport {
  certPath: string;
  keyPath: string;
  uploadedAt: number;
}

// Same reasoning as array.ts's stagedImports: single-admin, upload-then-immediately-decide flow,
// no need for a persisted store — just an in-memory map local to this route module, swept lazily.
const stagedTlsImports = new Map<string, StagedTlsImport>();
const TLS_STAGING_TTL_MS = 30 * 60 * 1000;

function sweepStagedTlsImports(): void {
  const cutoff = Date.now() - TLS_STAGING_TTL_MS;
  for (const [token, staged] of stagedTlsImports) {
    if (staged.uploadedAt < cutoff) {
      stagedTlsImports.delete(token);
      unlink(staged.certPath).catch(() => {});
      unlink(staged.keyPath).catch(() => {});
    }
  }
}

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

// Best-effort CN extraction from an openssl subject string ("CN = nonraid.lan" or
// "CN=nonraid.lan,O=Org", format varies by openssl version) — falls back to the full subject
// string if no CN component is found, so an unusual subject still gets *some* display name rather
// than an empty one.
function extractCommonName(subject: string): string {
  const match = subject.match(/CN\s*=\s*([^,/]+)/);
  return match?.[1] ? match[1].trim() : subject;
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

export function tlsRouter(tlsStore: TlsStore, activity: ActivityStore, authService: AuthService): Router {
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

  router.post(
    '/tls/import/preview',
    importUpload.fields([
      { name: 'cert', maxCount: 1 },
      { name: 'key', maxCount: 1 },
    ]),
    async (req, res) => {
      sweepStagedTlsImports();
      const files = req.files as { cert?: Express.Multer.File[]; key?: Express.Multer.File[] } | undefined;
      const certFile = files?.cert?.[0];
      const keyFile = files?.key?.[0];
      const cleanup = () =>
        Promise.all([certFile && unlink(certFile.path).catch(() => {}), keyFile && unlink(keyFile.path).catch(() => {})]);

      if (!certFile || !keyFile) {
        await cleanup();
        res.status(400).json({ error: 'Both a certificate and a private key file are required.' });
        return;
      }

      try {
        let info;
        try {
          info = await parseCertInfo(certFile.path);
        } catch {
          throw new HttpError(400, "That doesn't look like a valid PEM certificate.");
        }
        const { keyValid, keyMatchesCert } = await checkKeyMatchesCert(certFile.path, keyFile.path);
        if (!keyValid) {
          throw new HttpError(400, "That doesn't look like a valid, unencrypted PEM private key.");
        }
        if (info.notAfter.getTime() < Date.now()) {
          throw new HttpError(400, `This certificate expired on ${info.notAfter.toDateString()}.`);
        }

        const token = randomUUID();
        stagedTlsImports.set(token, { certPath: certFile.path, keyPath: keyFile.path, uploadedAt: Date.now() });

        res.json({
          token,
          subject: info.subject,
          issuer: info.issuer,
          notBefore: info.notBefore.getTime(),
          notAfter: info.notAfter.getTime(),
          sans: info.sans,
          keyMatchesCert,
          expiringSoon: info.notAfter.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000,
        });
      } catch (err) {
        await cleanup();
        handleError(err, res);
      }
    },
  );

  router.post('/tls/import/commit', async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const staged = token ? stagedTlsImports.get(token) : undefined;
    if (!staged) {
      res.status(400).json({ error: 'This import preview has expired or was already used — upload the files again.' });
      return;
    }
    stagedTlsImports.delete(token);

    try {
      // Re-checked against the live files rather than trusting whatever the client remembers from
      // the preview response — same reasoning as array.ts's import/commit.
      const info = await parseCertInfo(staged.certPath);
      const { keyValid, keyMatchesCert } = await checkKeyMatchesCert(staged.certPath, staged.keyPath);
      if (!keyValid) throw new HttpError(400, "That doesn't look like a valid, unencrypted PEM private key.");
      if (!keyMatchesCert) throw new HttpError(400, "This certificate and private key don't match — make sure you uploaded the correct pair.");
      if (info.notAfter.getTime() < Date.now()) throw new HttpError(400, `This certificate expired on ${info.notAfter.toDateString()}.`);

      await mkdir(config.tlsCertDir, { recursive: true });
      const certPath = path.join(config.tlsCertDir, 'cert.pem');
      const keyPath = path.join(config.tlsCertDir, 'key.pem');
      await copyFile(staged.certPath, certPath);
      await copyFile(staged.keyPath, keyPath);
      await chmod(keyPath, 0o600);

      const commonName = extractCommonName(info.subject);
      await tlsStore.setCert({
        source: 'imported',
        certPath,
        keyPath,
        commonName,
        sans: info.sans,
        issuedAt: info.notBefore.getTime(),
        expiresAt: info.notAfter.getTime(),
      });
      activity.log(`Imported a TLS certificate for ${commonName}`, 'blue').catch(() => {});
      res.json(statusPayload(await tlsStore.get()));
    } catch (err) {
      handleError(err, res);
    } finally {
      await unlink(staged.certPath).catch(() => {});
      await unlink(staged.keyPath).catch(() => {});
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

  router.post('/tls/disable', async (req, res) => {
    try {
      await tlsStore.setEnabled(false);
      // Flip before reissuing below so the fresh cookie is built non-Secure. Without this, the
      // browser keeps carrying the old Secure cookie — which it silently withholds on the
      // plain-HTTP page redirected to next — with no in-app way back in, since passkey login also
      // needs a secure context. Live-reproduced this exact lockout before adding the fix.
      config.cookieSecure = false;
      const { cookie } = await authService.reissueSession(req.headers.cookie);
      res.append('Set-Cookie', cookie);
      // req.hostname (not record.commonName) so the redirect target's host matches the cookie
      // above, which is host-only and bound to whatever host this request actually came in on —
      // relevant if the admin reached the site via something other than the cert's CN (a LAN IP,
      // a different DNS alias, ...).
      const newOrigin = originFor('http', req.hostname);
      activity.log('Disabling HTTPS — nonraid-webui is restarting', 'amber').catch(() => {});
      res.json({ ok: true, message: 'Restarting with HTTPS disabled — you will be redirected shortly.', newOrigin });
      scheduleSelfRestart(res);
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}
