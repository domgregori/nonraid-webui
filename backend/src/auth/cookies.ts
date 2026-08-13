import { config } from '../config.js';

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

function attributes(maxAgeSec: number): string {
  const parts = [`Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=${maxAgeSec}`];
  // Only correct once real TLS termination exists in front of this backend -
  // see config.ts's cookieSecure doc comment.
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

export function serializeSessionCookie(token: string, maxAgeSec: number): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; ${attributes(maxAgeSec)}`;
}

export function serializeClearCookie(): string {
  return `${COOKIE_NAME}=; ${attributes(0)}`;
}

export function serializeTwoFactorPendingCookie(token: string, maxAgeSec: number): string {
  return `${TWO_FACTOR_PENDING_COOKIE_NAME}=${encodeURIComponent(token)}; ${attributes(maxAgeSec)}`;
}

export function serializeClearTwoFactorPendingCookie(): string {
  return `${TWO_FACTOR_PENDING_COOKIE_NAME}=; ${attributes(0)}`;
}
