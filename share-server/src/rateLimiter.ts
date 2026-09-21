import type { NextFunction, Request, Response } from 'express';

// Deliberately duplicated from backend/src/auth/rateLimiter.ts's own factory (~35 lines) rather
// than shared - this is process-specific policy (this process's own limits/keys), not logic the
// two processes need to agree on the shape of, same reasoning cookies.ts's own duplication note
// gives.
//
// Keyed by clientIp() (see index.ts - prefers the Cf-Connecting-Ip header Cloudflare's edge sets,
// falling back to req.ip) rather than req.ip directly: every real visitor arrives via the
// Cloudflare Tunnel from 127.0.0.1 as far as this process's socket is concerned, so req.ip alone
// would throttle every visitor on the planet together as a single "IP".
export function createRateLimiter(windowMs: number, max: number, message: string, keyFn: (req: Request) => string) {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return function rateLimiter(req: Request, res: Response, next: NextFunction): void {
    const key = keyFn(req);
    const now = Date.now();
    const entry = attempts.get(key);

    if (!entry || entry.resetAt < now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (entry.count >= max) {
      res.status(429).json({ error: message });
      return;
    }

    entry.count += 1;
    next();
  };
}
