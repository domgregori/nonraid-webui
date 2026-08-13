import { mkdir, rename, unlink } from 'node:fs/promises';
import { isIP } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import { runSudoMaybe } from '../system/procUtil.js';
import { parseCertInfo } from './certInspect.js';
import type { TlsRecord } from './types.js';

// No slashes/control characters - avoids a CN value like "foo/CN=evil" injecting extra RDNs into
// openssl's -subj parsing (this is passed as a real argv entry, not through a shell, so there's
// no command-injection risk either way - this guard is purely about keeping the subject DN sane).
const NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,253}[A-Za-z0-9])?$/;

export function suggestCommonName(): string {
  return os.hostname();
}

export function suggestSans(commonName: string): string[] {
  const sans = [`DNS:${commonName}`, `DNS:${commonName}.local`];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.internal) continue;
      sans.push(`IP:${addr.address}`);
    }
  }
  return sans;
}

export interface GenerateSelfSignedInput {
  commonName: string;
  sans: string[];
  days: number;
}

export async function generateSelfSigned(input: GenerateSelfSignedInput): Promise<Omit<TlsRecord, 'enabled'>> {
  const commonName = input.commonName.trim();
  if (!NAME_PATTERN.test(commonName)) {
    throw new HttpError(400, 'Common name must be letters/digits/dots/hyphens only.');
  }
  const sans = input.sans.length > 0 ? input.sans : [`DNS:${commonName}`];
  for (const san of sans) {
    const [prefix, ...rest] = san.split(':');
    const value = rest.join(':');
    const valid = prefix === 'DNS' ? NAME_PATTERN.test(value) : prefix === 'IP' ? isIP(value) !== 0 : false;
    if (!valid) {
      throw new HttpError(400, `Invalid SAN entry: "${san}" (expected DNS:<host> or IP:<address>).`);
    }
  }
  if (!Number.isInteger(input.days) || input.days < 1) {
    throw new HttpError(400, 'days must be a positive integer.');
  }

  await mkdir(config.tlsCertDir, { recursive: true });
  const certPath = path.join(config.tlsCertDir, 'cert.pem');
  const keyPath = path.join(config.tlsCertDir, 'key.pem');
  const tmpCert = `${certPath}.tmp-${process.pid}`;
  const tmpKey = `${keyPath}.tmp-${process.pid}`;

  try {
    await runSudoMaybe(
      config.opensslBin,
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-keyout',
        tmpKey,
        '-out',
        tmpCert,
        '-days',
        String(input.days),
        '-nodes',
        '-subj',
        `/CN=${commonName}`,
        '-addext',
        `subjectAltName=${sans.join(',')}`,
      ],
      config.tlsUseSudo,
    );
  } catch (err) {
    await Promise.all([unlink(tmpCert).catch(() => {}), unlink(tmpKey).catch(() => {})]);
    throw new HttpError(502, `openssl failed to generate a certificate: ${(err as Error).message}`);
  }

  // tmpKey was created by openssl above, which ran as root when tlsUseSudo is on (the production
  // default) - unlike rename/unlink (which only need write permission on the containing
  // directory, already granted to this process since it owns tlsCertDir by default), chmod
  // requires owning the file itself, so an unprivileged chmod here throws EPERM whenever
  // tlsUseSudo is on.
  await runSudoMaybe('chmod', ['600', tmpKey], config.tlsUseSudo);
  await rename(tmpCert, certPath);
  await rename(tmpKey, keyPath);

  const info = await parseCertInfo(certPath);
  return {
    source: 'self-signed',
    certPath,
    keyPath,
    commonName,
    sans,
    issuedAt: info.notBefore.getTime(),
    expiresAt: info.notAfter.getTime(),
  };
}
