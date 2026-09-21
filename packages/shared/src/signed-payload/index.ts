import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Shared signing/verification core for every signed cookie/token this app
 * (across both the admin backend and share-server) issues - a "purpose"-
 * tagged, HMAC-SHA256-signed, expiring JSON payload. Extracted from
 * backend/src/auth/crypto.ts, which was the first consumer (session and
 * 2FA-pending cookies) - share-server's own unlock cookie is the second,
 * signed with its own independent secret, never the admin's session secret.
 *
 * Token format: "<base64url payload>.<base64url HMAC-SHA256 signature>".
 */
export function signPayload<T extends { purpose: string }>(secret: string, payload: T): string {
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payloadPart).digest('base64url');
  return `${payloadPart}.${signature}`;
}

/**
 * Never throws - a malformed, unsigned, expired, or wrong-purpose token is
 * just an unauthenticated request, not a server error.
 *
 * The `purpose` check is not incidental: two different kinds of token
 * signed with the same secret (see auth/crypto.ts's session vs.
 * 2FA-pending doc comment for the concrete example) would otherwise be
 * interchangeable just by pasting one into the other's cookie slot - the
 * discriminator baked into the signed payload itself, not the cookie name,
 * is what actually prevents that.
 */
export function verifyPayload<T extends { purpose: string }>(secret: string, token: string | undefined, purpose: T['purpose']): T | null {
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

    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as T;
    if (payload.purpose !== purpose) return null;
    if (typeof (payload as unknown as { expiresAt?: unknown }).expiresAt !== 'number' || (payload as unknown as { expiresAt: number }).expiresAt < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
