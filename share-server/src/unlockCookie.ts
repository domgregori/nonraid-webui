import { signPayload, verifyPayload } from '@nonraid/shared/signed-payload';

export interface ShareUnlockPayload {
  purpose: 'share_unlock';
  shareId: string;
  tokenHash: string;
  issuedAt: number;
  expiresAt: number;
}

// Named by shareId (not a single fixed cookie name) so a visitor with more than one share link
// unlocked at once (different tabs, or one link embedded inside another shared folder) gets one
// cookie per share rather than the second unlock silently clobbering the first.
export function unlockCookieName(shareId: string): string {
  return `su_${shareId}`;
}

export function signUnlockCookie(secret: string, shareId: string, tokenHash: string, ttlMs: number): string {
  const now = Date.now();
  return signPayload<ShareUnlockPayload>(secret, { purpose: 'share_unlock', shareId, tokenHash, issuedAt: now, expiresAt: now + ttlMs });
}

/**
 * Scans every `su_*` cookie on the request and returns the payload for whichever one was signed
 * for this exact tokenHash - the cookie's own signed value is self-contained proof of which share
 * it unlocks (shareId + the tokenHash it was issued for), so this process needs no server-side
 * session store or token-to-shareId cache at all to answer "is this visitor unlocked for the
 * share behind this URL's :token". A cookie signed for a different tokenHash (e.g. a stale cookie
 * from a share that was revoked and a new one created reusing... no, tokens are never reused, but
 * defense in depth costs nothing here) is simply ignored.
 */
export function findUnlockPayload(secret: string, cookies: Record<string, string>, tokenHash: string): ShareUnlockPayload | null {
  for (const [name, value] of Object.entries(cookies)) {
    if (!name.startsWith('su_')) continue;
    const payload = verifyPayload<ShareUnlockPayload>(secret, value, 'share_unlock');
    if (payload && payload.tokenHash === tokenHash) return payload;
  }
  return null;
}
