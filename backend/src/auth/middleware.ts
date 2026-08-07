import type { NextFunction, Request, Response } from 'express';
import type { AuthService } from './service.js';

/**
 * Gates every route mounted after it. Express 4 does not auto-catch a
 * rejected async middleware — an uncaught throw here would hang the request
 * forever with no response, not surface as a 500 — so this must never let
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
