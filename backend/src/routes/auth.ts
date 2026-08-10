import { Router, type Response } from 'express';
import type { ActivityStore } from '../activity/index.js';
import type { AuthService } from '../auth/index.js';
import { loginRateLimiter, totpVerifyRateLimiter } from '../auth/index.js';
import { serializeClearTwoFactorPendingCookie } from '../auth/cookies.js';
import {
  validateCurrentPasswordInput,
  validateLoginInput,
  validatePasswordChangeInput,
  validateSetupInput,
  validateTwoFactorCodeInput,
} from '../auth/validate.js';
import { HttpError } from '../httpError.js';

function handleError(err: unknown, res: Response) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
  } else {
    res.status(502).json({ error: (err as Error).message });
  }
}

export function authRouter(authService: AuthService, activity: ActivityStore): Router {
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

  // --- Two-factor: login-time verification (pending-cookie gated, reachable pre-session) ---

  router.post('/auth/2fa/totp/verify', totpVerifyRateLimiter, async (req, res) => {
    try {
      const code = validateTwoFactorCodeInput(req.body);
      const { cookie, body } = await authService.verifyTwoFactor(req.headers.cookie, code);
      res.append('Set-Cookie', cookie);
      // Clears the now-consumed pending cookie so it can't be reused to request another session
      // without the second factor being checked again.
      res.append('Set-Cookie', serializeClearTwoFactorPendingCookie());
      res.json(body);
    } catch (err) {
      handleError(err, res);
    }
  });

  // --- Two-factor: enrollment / management (session-gated) ---

  router.post('/auth/2fa/totp/enroll', async (req, res) => {
    try {
      res.json(await authService.enrollTotp(req.headers.cookie));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/auth/2fa/totp/confirm', totpVerifyRateLimiter, async (req, res) => {
    try {
      const code = validateTwoFactorCodeInput(req.body);
      const result = await authService.confirmTotp(req.headers.cookie, code);
      activity.log('Two-factor authentication (authenticator app) enabled', 'green').catch(() => {});
      res.json(result);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/auth/2fa/totp/disable', async (req, res) => {
    try {
      const currentPassword = validateCurrentPasswordInput(req.body);
      await authService.disableTotp(req.headers.cookie, currentPassword);
      activity.log('Two-factor authentication (authenticator app) disabled', 'amber').catch(() => {});
      res.json({ ok: true });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/auth/2fa/backup-codes/regenerate', async (req, res) => {
    try {
      const currentPassword = validateCurrentPasswordInput(req.body);
      const result = await authService.regenerateBackupCodes(req.headers.cookie, currentPassword);
      activity.log('Two-factor backup codes regenerated', 'blue').catch(() => {});
      res.json(result);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/auth/2fa/status', async (req, res) => {
    try {
      res.json(await authService.twoFactorStatus(req.headers.cookie));
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}
