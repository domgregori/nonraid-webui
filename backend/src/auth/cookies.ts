import { config } from '../config.js';
import type { RequestOrigin } from './requestOrigin.js';

export const COOKIE_NAME = 'nonraid_session';
// Separate cookie name from the real session, purely for request-routing convenience (so a route
// handler can read just the one it cares about without inspecting payload shape first) - the
// purpose discriminator in crypto.ts's signed payload is what actually prevents this from being
// usable as a real session, not the distinct name by itself.
export const TWO_FACTOR_PENDING_COOKIE_NAME = 'nonraid_2fa_pending';

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

function attributes(maxAgeSec: number, origin: RequestOrigin): string {
  const parts = [`Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=${maxAgeSec}`];
  // config.cookieSecure is the manual override (see its doc comment); origin.secure is Express's
  // own per-request read of the connection, proxy-aware when config.trustProxy is on - either one
  // being true is enough to mark the cookie Secure.
  if (config.cookieSecure || origin.secure) parts.push('Secure');
  return parts.join('; ');
}

export function serializeSessionCookie(token: string, maxAgeSec: number, origin: RequestOrigin): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; ${attributes(maxAgeSec, origin)}`;
}

export function serializeClearCookie(origin: RequestOrigin): string {
  return `${COOKIE_NAME}=; ${attributes(0, origin)}`;
}

export function serializeTwoFactorPendingCookie(token: string, maxAgeSec: number, origin: RequestOrigin): string {
  return `${TWO_FACTOR_PENDING_COOKIE_NAME}=${encodeURIComponent(token)}; ${attributes(maxAgeSec, origin)}`;
}

export function serializeClearTwoFactorPendingCookie(origin: RequestOrigin): string {
  return `${TWO_FACTOR_PENDING_COOKIE_NAME}=; ${attributes(0, origin)}`;
}
