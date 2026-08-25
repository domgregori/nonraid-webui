import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../httpError.js';
import type { AuthService } from './service.js';

/**
 * Gates every route mounted after it. Express 4 does not auto-catch a
 * rejected async middleware - an uncaught throw here would hang the request
 * forever with no response, not surface as a 500 - so this must never let
 * anything escape the try/catch, matching every route handler elsewhere in
 * this codebase.
 */
export function requireAuth(authService: AuthService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authenticated = await authService.isAuthenticated(req.headers.cookie);
      if (!authenticated) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      next();
    } catch {
      res.status(401).json({ error: 'Unauthorized' });
    }
  };
}

/**
 * Per-route step-up gate (unlike requireAuth above, which is mounted once for the whole app) -
 * for a mutation sensitive enough to want more than "has a valid session cookie", e.g. adding a
 * trusted SSH key (grants full root shell access). Expects `currentPassword` (required) and
 * `totpCode` (required only if the account has TOTP enrolled - see AuthService.verifyStepUp) in
 * the request body; pair with a rate limiter the same way session-gated TOTP re-checks already
 * are (routes/auth.ts's totpVerifyRateLimiter) since a 6-digit code is brute-forceable without
 * one. Reusable across any route that needs this same "prove it's really you again" gate, rather
 * than each mutator re-implementing its own password(+2FA) check inline.
 */
export function requireStepUp(authService: AuthService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const currentPassword = req.body?.currentPassword;
    const totpCode = req.body?.totpCode;
    if (typeof currentPassword !== 'string' || !currentPassword) {
      res.status(400).json({ error: 'currentPassword is required.' });
      return;
    }
    try {
      await authService.verifyStepUp(req.headers.cookie, currentPassword, typeof totpCode === 'string' ? totpCode : undefined);
      next();
    } catch (err) {
      if (err instanceof HttpError) res.status(err.status).json({ error: err.message });
      else res.status(401).json({ error: 'Unauthorized' });
    }
  };
}
