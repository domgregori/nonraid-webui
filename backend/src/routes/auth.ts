import { Router, type Response } from 'express';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { ActivityStore } from '../activity/index.js';
import type { AuthService } from '../auth/index.js';
import { loginRateLimiter, totpVerifyRateLimiter } from '../auth/index.js';
import { serializeClearTwoFactorPendingCookie } from '../auth/cookies.js';
import { requestOrigin } from '../auth/requestOrigin.js';
import {
  validateCurrentPasswordInput,
  validateLoginInput,
  validatePasskeyNameInput,
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

// The WebAuthn ceremony response objects from @simplewebauthn/browser are large, nested, and
// entirely re-validated by @simplewebauthn/server's own verify functions - this just guards
// against a missing/wrong-shaped body reaching those functions as something they'd choke on
// unhelpfully, not a full schema check.
function requireResponseField(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || typeof (input as Record<string, unknown>).response !== 'object') {
    throw new HttpError(400, 'response is required.');
  }
  return (input as Record<string, unknown>).response;
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
      const { cookie, body } = await authService.setup(username, password, requestOrigin(req));
      res.append('Set-Cookie', cookie);
      res.status(201).json(body);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/auth/login', loginRateLimiter, async (req, res) => {
    try {
      const { username, password } = validateLoginInput(req.body);
      const { cookie, body } = await authService.login(username, password, requestOrigin(req));
      res.append('Set-Cookie', cookie);
      res.json(body);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/auth/logout', (req, res) => {
    const { cookie } = authService.logout(requestOrigin(req));
    res.append('Set-Cookie', cookie);
    res.json({ configured: true, authenticated: false });
  });

  router.put('/auth/password', totpVerifyRateLimiter, async (req, res) => {
    try {
      const { currentPassword, newPassword, totpCode } = validatePasswordChangeInput(req.body);
      const { cookie, body } = await authService.changePassword(req.headers.cookie, currentPassword, newPassword, totpCode, requestOrigin(req));
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
      const origin = requestOrigin(req);
      const { cookie, body } = await authService.verifyTwoFactor(req.headers.cookie, code, origin);
      res.append('Set-Cookie', cookie);
      // Clears the now-consumed pending cookie so it can't be reused to request another session
      // without the second factor being checked again.
      res.append('Set-Cookie', serializeClearTwoFactorPendingCookie(origin));
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

  // --- Two-factor: passkeys ---

  router.post('/auth/2fa/passkey/auth-options', async (req, res) => {
    try {
      res.json(await authService.passkeyAuthOptions(req.headers.cookie, requestOrigin(req)));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/auth/2fa/passkey/auth-verify', async (req, res) => {
    try {
      const response = requireResponseField(req.body) as AuthenticationResponseJSON;
      const origin = requestOrigin(req);
      const { cookie, body } = await authService.passkeyAuthVerify(req.headers.cookie, response, origin);
      res.append('Set-Cookie', cookie);
      res.append('Set-Cookie', serializeClearTwoFactorPendingCookie(origin));
      res.json(body);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/auth/2fa/passkey/register-options', async (req, res) => {
    try {
      res.json(await authService.passkeyRegisterOptions(req.headers.cookie, requestOrigin(req)));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/auth/2fa/passkey/register-verify', async (req, res) => {
    try {
      const response = requireResponseField(req.body) as RegistrationResponseJSON;
      const name = validatePasskeyNameInput(req.body);
      await authService.passkeyRegisterVerify(req.headers.cookie, response, name, requestOrigin(req));
      activity.log(`Passkey "${name}" added`, 'green').catch(() => {});
      res.json({ ok: true });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.delete('/auth/2fa/passkey/:id', async (req, res) => {
    try {
      await authService.removePasskey(req.headers.cookie, req.params.id);
      activity.log('Passkey removed', 'amber').catch(() => {});
      res.json({ ok: true });
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}
