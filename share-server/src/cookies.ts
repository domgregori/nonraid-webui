// Deliberately duplicated from backend/src/auth/cookies.ts's parseCookies (~15 lines) rather than
// shared - this process's cookie handling is process-specific glue around its own SHARE_UNLOCK_SECRET
// and its own `su_<shareId>` naming, not logic the two processes need to agree on the shape of (unlike
// the signed-payload primitive itself, which IS shared - see @nonraid/shared/signed-payload).

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

export function serializeCookie(name: string, value: string, maxAgeSec: number, secure: boolean): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function serializeClearCookie(name: string, secure: boolean): string {
  return serializeCookie(name, '', 0, secure);
}
