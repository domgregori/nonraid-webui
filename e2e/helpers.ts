import { request, type APIRequestContext } from '@playwright/test'

/** Session cookie name the backend sets on a successful login (backend/src/auth/cookies.ts). */
export const SESSION_COOKIE_NAME = 'nonraid_session'

/** Default password used when E2E_PASSWORD is not provided (matches the installer default). */
export const DEFAULT_PASSWORD = 'testingnonraid'

/**
 * Shape of the POST /api/auth/login response body (backend/src/auth/service.ts login()):
 * a plain session on success, otherwise a two-factor-required marker.
 */
export interface LoginResponseBody {
  configured: boolean
  authenticated: boolean
  twoFactorRequired?: boolean
  twoFactorMethods?: string[]
}

export interface LoginOptions {
  baseURL: string
  username: string
  password?: string
}

export interface LoginResult {
  /** APIRequestContext whose cookie jar now holds the session cookie. Caller must dispose(). */
  context: APIRequestContext
  body: LoginResponseBody
  /** Raw Set-Cookie header(s) from the login response; multiple cookies are newline-joined. */
  setCookie: string
}

/**
 * POST /api/auth/login with JSON { username, password } and return the request context
 * (its cookie jar now holds the session cookie) plus the parsed response body.
 * Throws on a non-2xx response with the backend's own error message.
 */
export async function loginViaApi({ baseURL, username, password = DEFAULT_PASSWORD }: LoginOptions): Promise<LoginResult> {
  const context = await request.newContext({ baseURL })
  try {
    const res = await context.post('/api/auth/login', { data: { username, password } })
    const body = (await res.json().catch(() => null)) as LoginResponseBody | null

    if (!res.ok()) {
      const detail = body && 'error' in body ? String((body as { error: unknown }).error) : `HTTP ${res.status()}`
      throw new Error(`Login failed (${detail}). Check E2E_USERNAME/E2E_PASSWORD.`)
    }
    if (!body) {
      throw new Error('Login returned an unparseable response body.')
    }
    return { context, body, setCookie: res.headers()['set-cookie'] ?? '' }
  } catch (err) {
    await context.dispose()
    throw err
  }
}

/** Returns true when the login response carried a real session cookie (vs. a 2FA-pending cookie). */
export function hasSessionCookie(setCookie: string): boolean {
  return setCookie.includes(`${SESSION_COOKIE_NAME}=`)
}

/**
 * Fails the run when the login response indicates a second factor is required.
 * The E2E harness deliberately does not solve 2FA - an operator must handle it.
 */
export function expectNoTwoFactorRequired(body: LoginResponseBody): void {
  if (body.twoFactorRequired || body.authenticated !== true) {
    const methods = JSON.stringify(body.twoFactorMethods ?? [])
    throw new Error(
      `Login requires a second factor (twoFactorMethods: ${methods}) - the E2E harness does not solve 2FA. ` +
        'Disable 2FA on the rig or provide a session that has already completed it.',
    )
  }
}
