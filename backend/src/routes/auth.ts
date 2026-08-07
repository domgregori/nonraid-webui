import { Router, type Response } from 'express';
import type { AuthService } from '../auth/index.js';
import { loginRateLimiter } from '../auth/index.js';
import { validateLoginInput, validatePasswordChangeInput, validateSetupInput } from '../auth/validate.js';
import { HttpError } from '../httpError.js';

function handleError(err: unknown, res: Response) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
  } else {
    res.status(502).json({ error: (err as Error).message });
  }
}

export function authRouter(authService: AuthService): Router {
  const router = Router();

  router.get('/auth/status', async (req, res) => {
    try {
      res.json(await authService.status(req.headers.cookie));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/auth/setup', async (req, res) => {
    try {
      const { username, password } = validateSetupInput(req.body);
      const { cookie, body } = await authService.setup(username, password);
      res.append('Set-Cookie', cookie);
      res.status(201).json(body);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/auth/login', loginRateLimiter, async (req, res) => {
    try {
      const { username, password } = validateLoginInput(req.body);
      const { cookie, body } = await authService.login(username, password);
      res.append('Set-Cookie', cookie);
      res.json(body);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/auth/logout', (_req, res) => {
    const { cookie } = authService.logout();
    res.append('Set-Cookie', cookie);
    res.json({ configured: true, authenticated: false });
  });

  router.put('/auth/password', async (req, res) => {
    try {
      const { currentPassword, newPassword } = validatePasswordChangeInput(req.body);
      const { cookie, body } = await authService.changePassword(req.headers.cookie, currentPassword, newPassword);
      res.append('Set-Cookie', cookie);
      res.json(body);
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}
