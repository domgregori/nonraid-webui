// Session-cookie login, used only for the two moments the CLI needs a real session rather than a
// bearer token: `nonraid login`'s one-time token-minting bootstrap, and `nonraid logout --revoke`'s
// optional server-side cleanup (see logout.ts's doc comment for why revocation itself needs this).
// Every other command in this CLI talks to the API purely via Authorization: Bearer, never cookies.
import prompts from 'prompts';

interface LoginBody {
  configured: boolean;
  authenticated: boolean;
  twoFactorRequired?: true;
  twoFactorMethods?: ('totp' | 'passkey')[];
}

// Node's fetch Headers implements the modern getSetCookie() (returns every Set-Cookie line
// separately, unlike get('set-cookie') which the Fetch spec deliberately folds into one
// comma-joined string a cookie parser can't safely split back apart).
function mergeSetCookies(existing: string, res: Response): string {
  const jar = new Map<string, string>();
  for (const part of existing.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) jar.set(part.slice(0, eq).trim(), part.slice(eq + 1));
  }
  const setCookies = res.headers.getSetCookie();
  for (const raw of setCookies) {
    const first = raw.split(';')[0] ?? '';
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1);
    if (value === '') jar.delete(name);
    else jar.set(name, value);
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function postJson(base: string, path: string, body: unknown, cookie: string): Promise<{ res: Response; body: unknown }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { res, body: text ? JSON.parse(text) : undefined };
}

const onCancel = () => {
  console.error('Aborted.');
  process.exit(130);
};

export interface PasswordLoginResult {
  cookie: string;
  // Returned alongside the cookie because the caller's very next call (POST /auth/tokens) is
  // itself step-up gated - same class of risk as adding a trusted SSH key - so it needs the
  // password again rather than just the session cookie. Password re-verification is idempotent
  // (a plain hash compare), safe to reuse. The 2FA code from login is deliberately NOT returned
  // here even when one was entered: if the account used a one-time backup code rather than TOTP,
  // that code was already consumed by verifyTwoFactor above, and reusing it for the step-up check
  // would fail with "Incorrect code" - a backup code can only ever verify once. login.ts instead
  // prompts fresh for a step-up code only if the backend actually asks for one.
  password: string;
}

/**
 * Walks username/password (+TOTP/backup-code 2FA if enrolled) and returns a session Cookie header
 * on success. Passkey-only accounts can't complete this from a terminal (no WebAuthn ceremony
 * here) - such an account should enroll TOTP or a backup code as a fallback, same recommendation
 * the frontend already gives for any non-browser use case.
 */
export async function passwordLogin(base: string): Promise<PasswordLoginResult> {
  const { username, password } = await prompts(
    [
      { type: 'text', name: 'username', message: 'Username' },
      { type: 'password', name: 'password', message: 'Password' },
    ],
    { onCancel },
  );
  if (!username || !password) throw new Error('Username and password are required.');

  let cookie = '';
  const login = await postJson(base, '/api/auth/login', { username, password }, cookie);
  if (!login.res.ok) throw new Error((login.body as { error?: string })?.error ?? 'Login failed.');
  cookie = mergeSetCookies(cookie, login.res);

  const loginBody = login.body as LoginBody;
  if (loginBody.twoFactorRequired) {
    if (!loginBody.twoFactorMethods?.includes('totp')) {
      throw new Error('This account only has passkey two-factor enrolled, which the CLI cannot complete - enroll TOTP or a backup code as a fallback in the web UI first.');
    }
    const { code } = await prompts({ type: 'text', name: 'code', message: 'Two-factor code (or backup code)' }, { onCancel });
    if (!code) throw new Error('A code is required.');
    const verify = await postJson(base, '/api/auth/2fa/totp/verify', { code }, cookie);
    if (!verify.res.ok) throw new Error((verify.body as { error?: string })?.error ?? 'Two-factor verification failed.');
    cookie = mergeSetCookies(cookie, verify.res);
  }

  return { cookie, password };
}

/**
 * Calls a step-up-gated route (POST /auth/tokens, DELETE /auth/tokens/:id - both require a real
 * session plus password+TOTP re-verification, same as the web UI's SSH-key add/remove) with the
 * password `passwordLogin` already collected. Only prompts for a 2FA code if the backend actually
 * asks for one - see `PasswordLoginResult.password`'s doc comment for why a login-time code can't
 * just be reused here.
 */
export async function stepUpFetch(base: string, path: string, method: 'POST' | 'DELETE', cookie: string, password: string, extraBody: Record<string, unknown> = {}): Promise<unknown> {
  const attempt = async (totpCode?: string) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ ...extraBody, currentPassword: password, ...(totpCode ? { totpCode } : {}) }),
    });
    const text = await res.text();
    return { res, body: text ? JSON.parse(text) : undefined };
  };

  let result = await attempt();
  if (!result.res.ok && (result.body as { error?: string } | undefined)?.error === 'Two-factor code is required.') {
    const { code } = await prompts({ type: 'text', name: 'code', message: 'Two-factor code (or backup code), to confirm' }, { onCancel });
    if (!code) throw new Error('A code is required.');
    result = await attempt(code);
  }
  if (!result.res.ok) throw new Error((result.body as { error?: string } | undefined)?.error ?? `Request failed (${result.res.status}).`);
  return result.body;
}
