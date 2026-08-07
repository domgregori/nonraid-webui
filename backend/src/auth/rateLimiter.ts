import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';

// In-memory, keyed by req.ip — assumes no reverse proxy in front of this
// backend today (no `trust proxy` is set anywhere in index.ts, so req.ip is
// the real connecting address). If this ever sits behind a reverse proxy,
// every client would appear as the proxy's single IP and this would throttle
// everyone together — revisit `trust proxy` + X-Forwarded-For then.
const attempts = new Map<string, { count: number; resetAt: number }>();

export function loginRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip ?? 'unknown';
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + config.loginRateLimitWindowMs });
    next();
    return;
  }

  if (entry.count >= config.loginRateLimitMax) {
    res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    return;
  }

  entry.count += 1;
  next();
}
