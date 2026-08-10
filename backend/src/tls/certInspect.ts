import { config } from '../config.js';
import { runSudoMaybe } from '../system/procUtil.js';

export interface CertInfo {
  subject: string;
  issuer: string;
  notBefore: Date;
  notAfter: Date;
  sans: string[];
}

// openssl's -startdate/-enddate output ("notBefore=Aug 10 12:00:00 2026 GMT") is a format
// Node's Date constructor parses natively — no manual date-string handling needed.
function parseDateLine(line: string): Date {
  const value = line.split('=').slice(1).join('=').trim();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Could not parse certificate date: "${line}"`);
  return date;
}

export async function parseCertInfo(certPath: string): Promise<CertInfo> {
  const { stdout } = await runSudoMaybe(
    config.opensslBin,
    ['x509', '-in', certPath, '-noout', '-subject', '-issuer', '-startdate', '-enddate'],
    config.tlsUseSudo,
  );
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const subjectLine = lines.find((l) => l.startsWith('subject='));
  const issuerLine = lines.find((l) => l.startsWith('issuer='));
  const notBeforeLine = lines.find((l) => l.startsWith('notBefore='));
  const notAfterLine = lines.find((l) => l.startsWith('notAfter='));
  if (!subjectLine || !issuerLine || !notBeforeLine || !notAfterLine) {
    throw new Error('Unexpected output from openssl x509 — could not parse certificate.');
  }

  // subjectAltName is queried separately: -ext isn't valid alongside the flags above in every
  // openssl version, and a cert with no SAN extension at all (rare, but possible for an
  // externally-supplied import) shouldn't fail the whole parse.
  let sans: string[] = [];
  try {
    const { stdout: extOut } = await runSudoMaybe(config.opensslBin, ['x509', '-in', certPath, '-noout', '-ext', 'subjectAltName'], config.tlsUseSudo);
    sans = extOut
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('X509v3 Subject Alternative Name'))
      .join(',')
      .split(',')
      .map((s) => s.trim().replace(/^IP Address:/, 'IP:'))
      .filter(Boolean);
  } catch {
    sans = []; // no SAN extension present — not a parse failure
  }

  return {
    subject: subjectLine.slice('subject='.length).trim(),
    issuer: issuerLine.slice('issuer='.length).trim(),
    notBefore: parseDateLine(notBeforeLine),
    notAfter: parseDateLine(notAfterLine),
    sans,
  };
}
