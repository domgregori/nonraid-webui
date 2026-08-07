import { randomBytes, createHmac, timingSafeEqual, scrypt } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;

// Async scrypt (not scryptSync) deliberately — the sync version blocks the
// event loop for ~50-100ms per call, which would stall this process's other
// live pollers (SystemStatsService, the LXC stats poller, ...) on every login
// attempt. The async form runs on libuv's threadpool instead.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function generateSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Session cookie = signed {issuedAt, expiresAt}, no server-side session
 * table — see store.ts's AuthRecord.sessionSecret doc comment for why. The
 * token is "<base64url payload>.<base64url HMAC-SHA256 signature>".
 */
export function signSession(secret: string, ttlMs: number): string {
  const now = Date.now();
  const payload: { issuedAt: number; expiresAt: number } = { issuedAt: now, expiresAt: now + ttlMs };
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payloadPart).digest('base64url');
  return `${payloadPart}.${signature}`;
}

/**
 * Never throws — a malformed, unsigned, or expired token is just an
 * unauthenticated request, not a server error. requireAuth() relies on this.
 */
export function verifySession(secret: string, token: string | undefined): { issuedAt: number; expiresAt: number } | null {
  if (!token) return null;
  const dotIndex = token.indexOf('.');
  if (dotIndex < 0) return null;
  const payloadPart = token.slice(0, dotIndex);
  const signaturePart = token.slice(dotIndex + 1);

  try {
    const expectedSignature = createHmac('sha256', secret).update(payloadPart).digest();
    const actualSignature = Buffer.from(signaturePart, 'base64url');
    if (actualSignature.length !== expectedSignature.length) return null;
    if (!timingSafeEqual(actualSignature, expectedSignature)) return null;

    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as { issuedAt: number; expiresAt: number };
    if (typeof payload.expiresAt !== 'number' || payload.expiresAt < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
