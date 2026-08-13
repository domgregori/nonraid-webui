import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';

// In-memory, keyed by req.ip - the real connecting address by default. Behind a reverse proxy
// without config.trustProxy enabled, every client appears as the proxy's single IP and this
// throttles everyone together; enabling trustProxy (index.ts sets `trust proxy`) makes req.ip
// trust X-Forwarded-For instead, fixing this the same way it fixes cookie/WebAuthn origin
// detection (see requestOrigin.ts).
//
// Each limiter gets its own Map, not a shared one keyed by IP alone - login
// attempts and TOTP-verify attempts are different actions, and an IP that's
// exhausted one shouldn't have that count bleed into the other.
function createRateLimiter(windowMs: () => number, max: () => number, message: string) {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return function rateLimiter(req: Request, res: Response, next: NextFunction): void {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const entry = attempts.get(key);

    if (!entry || entry.resetAt < now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs() });
      next();
      return;
    }

    if (entry.count >= max()) {
      res.status(429).json({ error: message });
      return;
    }

    entry.count += 1;
    next();
  };
}

export const loginRateLimiter = createRateLimiter(
  () => config.loginRateLimitWindowMs,
  () => config.loginRateLimitMax,
  'Too many login attempts. Try again later.',
);

// Applied to both the login-time TOTP verify (the important one - reachable pre-authentication,
// and 6-digit codes are brute-forceable without this) and the enrollment-time confirm (smaller
// attack surface since it's session-gated, but cheap defense-in-depth against guessing during the
// enrollment window).
export const totpVerifyRateLimiter = createRateLimiter(
  () => config.totpRateLimitWindowMs,
  () => config.totpRateLimitMax,
  'Too many verification attempts. Try again later.',
);
