# backend/src/auth/

## Responsibility
Single-admin authentication for the whole dashboard: setup/login, stateless session cookies, two-factor (TOTP, passkeys, backup codes), and the `requireAuth` gate that protects every `/api` route.

## Design
- `store.ts` owns `auth.json` (one `AuthRecord`: username, scrypt `passwordHash`, `sessionSecret`) using the shared pattern — in-memory cache, writes serialized through one promise chain, atomic write-then-rename; fail-loud on corrupt JSON. `create()` keeps its own rejectable queue so concurrent setup attempts serialize to a clean 409.
- Stateless signed cookies (`crypto.ts`): token = `base64url(payload).base64url(HMAC-SHA256)` where payload is `{purpose, issuedAt, expiresAt}`. The `purpose` discriminator (`'session'` vs `'twofactor_pending'`) is what stops a pending-2FA token being replayed as a real session — both are signed with the same account secret. `verifyPayload` never throws; a bad token is just an unauthenticated request.
- `cookies.ts` serializes `nonraid_session` / `nonraid_2fa_pending` (HttpOnly, SameSite=Lax, `Secure` when `config.cookieSecure` or the request is secure). `requestOrigin.ts` extracts proxy-aware `secure`/`hostname`.
- 2FA: `totp.ts` (otplib, ±1-step tolerance, QR rendered locally via qrcode); `webauthn.ts` (@simplewebauthn/server, one-shot in-memory challenges, never persisted); backup codes are scrypt-hashed Crockford-base32 strings, consumed atomically inside one store write-queue closure to prevent double-spending.
- `rateLimiter.ts`: independent in-memory per-IP maps for login and TOTP-verify. `validate.ts` keeps error shape generic (bad login always fails as a plain 401). `requireAuth` (`middleware.ts`) wraps its work in try/catch because Express 4 never catches a rejected async middleware.

## Flow
`POST /auth/setup` → `store.create` (409 if configured) → issue session cookie. `POST /auth/login` → verify password → if 2FA enrolled, set a pending cookie + return `twoFactorMethods`; else issue the session. `verifyTwoFactor` / `passkeyAuthVerify` consume the pending cookie, then issue the real session via the same `issueSession` path and clear the pending cookie. Every later request passes through `requireAuth` → `verifySession`. `changePassword` regenerates `sessionSecret`, logging out all other sessions while reissuing a fresh cookie for the current one.

## Integration
Consumed by `routes/auth.ts` (mounted pre-gate) and by `requireAuth` in `index.ts` gating all other routers. `routes/tls.ts` uses `authService.reissueSession` when disabling HTTPS (cookieSecure flip). Depends on `config` (session/2FA TTLs) and logs 2FA events to `ActivityStore`.
