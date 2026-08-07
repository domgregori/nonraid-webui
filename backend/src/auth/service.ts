import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import type { AuthStore } from './store.js';
import { serializeClearCookie, serializeSessionCookie, parseCookies, COOKIE_NAME } from './cookies.js';
import { hashPassword, verifyPassword, signSession, verifySession } from './crypto.js';
import type { AuthStatus } from './types.js';

export interface AuthResult {
  cookie: string;
  body: AuthStatus;
}

export class AuthService {
  constructor(private store: AuthStore) {}

  async isConfigured(): Promise<boolean> {
    return (await this.store.get()) !== null;
  }

  async isAuthenticated(cookieHeader: string | undefined): Promise<boolean> {
    const record = await this.store.get();
    if (!record) return false;
    const cookies = parseCookies(cookieHeader);
    return verifySession(record.sessionSecret, cookies[COOKIE_NAME]) !== null;
  }

  async status(cookieHeader: string | undefined): Promise<AuthStatus> {
    const record = await this.store.get();
    if (!record) return { configured: false, authenticated: false };
    const cookies = parseCookies(cookieHeader);
    const authenticated = verifySession(record.sessionSecret, cookies[COOKIE_NAME]) !== null;
    return { configured: true, authenticated };
  }

  async setup(username: string, password: string): Promise<AuthResult> {
    const passwordHash = await hashPassword(password);
    const record = await this.store.create(username, passwordHash);
    return this.issueSession(record.sessionSecret);
  }

  async login(username: string, password: string): Promise<AuthResult> {
    const record = await this.store.get();
    if (!record) {
      throw new HttpError(409, 'No admin account is configured yet.');
    }
    // Constant-shape check regardless of which field is wrong — a bad guess
    // fails as a generic 401, never distinguishing "no such user" from
    // "wrong password" (this is a single-account system, so username
    // mismatches are effectively part of the same guess).
    const ok = username === record.username && (await verifyPassword(password, record.passwordHash));
    if (!ok) {
      throw new HttpError(401, 'Invalid username or password.');
    }
    return this.issueSession(record.sessionSecret);
  }

  logout(): { cookie: string } {
    return { cookie: serializeClearCookie() };
  }

  async changePassword(cookieHeader: string | undefined, currentPassword: string, newPassword: string): Promise<AuthResult> {
    const record = await this.store.get();
    if (!record) {
      throw new HttpError(409, 'No admin account is configured yet.');
    }
    const cookies = parseCookies(cookieHeader);
    if (verifySession(record.sessionSecret, cookies[COOKIE_NAME]) === null) {
      throw new HttpError(401, 'Unauthorized');
    }
    if (!(await verifyPassword(currentPassword, record.passwordHash))) {
      throw new HttpError(401, 'Current password is incorrect.');
    }
    const newHash = await hashPassword(newPassword);
    const updated = await this.store.updatePassword(newHash);
    // Regenerated secret invalidates the cookie that authenticated this very
    // request too — issue a fresh one against the new secret so this session
    // keeps working, while every other open session is now logged out.
    return this.issueSession(updated.sessionSecret);
  }

  private issueSession(secret: string): AuthResult {
    const token = signSession(secret, config.sessionTtlMs);
    const cookie = serializeSessionCookie(token, Math.floor(config.sessionTtlMs / 1000));
    return { cookie, body: { configured: true, authenticated: true } };
  }
}
