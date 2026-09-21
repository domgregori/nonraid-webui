import { randomBytes, timingSafeEqual, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { signPayload, verifyPayload } from '@nonraid/shared/signed-payload';
import type { SessionPayload, TwoFactorPendingPayload } from './types.js';

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;

// Async scrypt (not scryptSync) deliberately - the sync version blocks the
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

// Backup codes are hashed with the exact same scrypt format as passwordHash - these are just
// readability aliases at call sites that hash/verify a backup code rather than a login password.
export const hashSecret = hashPassword;
export const verifySecret = verifyPassword;

// 12 random chars from a base32-ish alphabet (Crockford, no ambiguous 0/O/1/I/L), dash-grouped for
// readability - e.g. "A3F9-K2M8-XQ7Z". 256 % 32 === 0, so `byte % alphabet.length` is unbiased.
// Generated 10 at a time at TOTP confirmation/regeneration.
const BACKUP_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function generateBackupCode(): string {
  const bytes = randomBytes(12);
  let code = '';
  for (const byte of bytes) {
    code += BACKUP_CODE_ALPHABET[byte % BACKUP_CODE_ALPHABET.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}

// CLI/API bearer tokens - "nrd_" prefix keeps them greppable/recognizable (e.g. in shell history
// or a leaked log line) the way "ghp_"/"sk_" prefixes work for other token systems. 24 random
// bytes base64url-encoded gives 32 chars of entropy after the prefix, comfortably more than the
// backup-code alphabet above needs to guard against guessing. Hashed at rest with hashSecret, same
// as everything else in this file that isn't itself a signed cookie payload - see ApiToken's doc
// comment in types.ts.
export function generateApiToken(): string {
  return `nrd_${randomBytes(24).toString('base64url')}`;
}

// Share-link bearer tokens (backend/src/shareLinks/) - same shape as generateApiToken above, just
// a distinct "shl_" prefix so one glance at a leaked value (shell history, a log line) says which
// kind of credential it is. Hashed at rest with SHA-256, not hashSecret/scrypt (see
// shareLinks/service.ts for why - it's a high-entropy bearer credential looked up on every
// anonymous request, where scrypt's per-lookup cost would be a real DoS vector for no benefit).
export function generateShareToken(): string {
  return `shl_${randomBytes(24).toString('base64url')}`;
}

// signPayload/verifyPayload (the generic "signed {purpose, issuedAt, expiresAt}" core every cookie
// this app issues is built on - session and 2FA-pending cookies here, share-server's own unlock
// cookie with its own independent secret) now live in @nonraid/shared/signed-payload, imported
// above - share-server needs the identical primitive and has no dependency on this file. Not
// re-exported from here: signSession/verifySession/signTwoFactorPending/verifyTwoFactorPending
// below are this app's own real public surface, each fixing `purpose` so a caller can never
// accidentally sign or accept the wrong kind.
//
// The `purpose` check is not incidental: session and 2FA-pending tokens are both signed with the
// same account sessionSecret (deliberately - see TwoFactorPendingPayload's doc comment), so without
// a discriminator baked into the signed payload itself, a pending-2FA token would carry a valid
// signature under the exact same key a real session cookie does. Pasting one into the other
// cookie's name would then verify as a fully authenticated session, skipping the second factor
// entirely. The discriminator, not the cookie name, is what actually prevents that.

export function signSession(secret: string, ttlMs: number): string {
  const now = Date.now();
  return signPayload<SessionPayload>(secret, { purpose: 'session', issuedAt: now, expiresAt: now + ttlMs });
}

export function verifySession(secret: string, token: string | undefined): SessionPayload | null {
  return verifyPayload<SessionPayload>(secret, token, 'session');
}

// Issued after a correct password, before the second factor is verified - see
// TwoFactorPendingPayload's doc comment for why this is safe to sign with the same account secret
// a real session uses.
export function signTwoFactorPending(secret: string, ttlMs: number): string {
  const now = Date.now();
  return signPayload<TwoFactorPendingPayload>(secret, { purpose: 'twofactor_pending', issuedAt: now, expiresAt: now + ttlMs });
}

export function verifyTwoFactorPending(secret: string, token: string | undefined): TwoFactorPendingPayload | null {
  return verifyPayload<TwoFactorPendingPayload>(secret, token, 'twofactor_pending');
}
