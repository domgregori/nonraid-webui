import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';

// In-memory, keyed by req.ip — assumes no reverse proxy in front of this
// backend today (no `trust proxy` is set anywhere in index.ts, so req.ip is
// the real connecting address). If this ever sits behind a reverse proxy,
// every client would appear as the proxy's single IP and this would throttle
// everyone together — revisit `trust proxy` + X-Forwarded-For then.
//
// Each limiter gets its own Map, not a shared one keyed by IP alone — login
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

// Applied to both the login-time TOTP verify (the important one — reachable pre-authentication,
// and 6-digit codes are brute-forceable without this) and the enrollment-time confirm (smaller
// attack surface since it's session-gated, but cheap defense-in-depth against guessing during the
// enrollment window).
export const totpVerifyRateLimiter = createRateLimiter(
  () => config.totpRateLimitWindowMs,
  () => config.totpRateLimitMax,
  'Too many verification attempts. Try again later.',
);
