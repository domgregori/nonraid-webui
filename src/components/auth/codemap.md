# src/components/auth/

## Responsibility

The two-factor completion step of the login flow.

## Design

- `TwoFactorStep` receives the `methods` the session allows (from the login response) and lets the user finish sign-in via TOTP code or passkey.
- Defaults to the code form unless TOTP was never enrolled and a passkey is usable (`canUsePasskey = methods.includes('passkey') && webauthnAvailable()`); the two modes swap via "Use a passkey/code instead" buttons rather than hiding one another.
- TOTP path: `authApi.verifyTotp(code)`; passkey path: `authApi.passkeyAuthOptions()` -> `startAuthentication` (`@simplewebauthn/browser`) -> `authApi.passkeyAuthVerify(response)`. Both then call `useAuth().completeTwoFactor()`.
- `UnauthorizedError` (bare 401, no body) is translated to "Incorrect code." / "Passkey authentication failed." since the backend's real message never reaches the client.

## Flow

`LoginPage` renders the password step first, then swaps to `<TwoFactorStep methods={...} />`; success completes the auth state and the provider tree re-renders into the app.

## Integration

Mounted from `LoginPage`. Uses `authApi`, `useAuth`, and the `webauthnSupport` utility. Styling in `src/styles/auth.css`.
