import { HttpError } from '../httpError.js';
import type { ApiTokenScope } from './types.js';

// This admin credential has nothing to do with the OS - unlike
// users/validate.ts's NAME_RE, which exists because those become real
// useradd/smbpasswd accounts. Printable ASCII only, trimmed, no Linux
// username constraints.
const USERNAME_RE = /^[\x20-\x7e]{3,64}$/;
const MIN_PASSWORD_LENGTH = 10; // higher than the Samba path's 8 - this credential
// gates the whole API, not one share's worth of access. Length over
// character-class complexity, matching current NIST 800-63B guidance.
const MAX_PASSWORD_LENGTH = 256;

export interface Credentials {
  username: string;
  password: string;
}

export function validateSetupInput(input: unknown): Credentials {
  if (typeof input !== 'object' || input === null) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  const i = input as Record<string, unknown>;

  const username = typeof i.username === 'string' ? i.username.trim() : '';
  if (!USERNAME_RE.test(username)) {
    throw new HttpError(400, 'Username must be 3-64 printable characters.');
  }
  if (typeof i.password !== 'string' || i.password.length < MIN_PASSWORD_LENGTH || i.password.length > MAX_PASSWORD_LENGTH) {
    throw new HttpError(400, `Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.`);
  }

  return { username, password: i.password };
}

// Deliberately loose - a bad guess should fail as a generic 401 on the login
// route, not leak which specific rule it violated.
export function validateLoginInput(input: unknown): Credentials {
  if (typeof input !== 'object' || input === null) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  const i = input as Record<string, unknown>;
  if (typeof i.username !== 'string' || !i.username || typeof i.password !== 'string' || !i.password) {
    throw new HttpError(400, 'username and password are required.');
  }
  return { username: i.username, password: i.password };
}

export interface PasswordChange {
  currentPassword: string;
  newPassword: string;
  totpCode: string | undefined;
}

// Shared by validatePasswordChangeInput below and the 2FA disable/regenerate-backup-codes
// endpoints, which both require current-password re-entry before a security-relevant action.
export function validateCurrentPasswordInput(input: unknown): string {
  if (typeof input !== 'object' || input === null) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  const i = input as Record<string, unknown>;
  if (typeof i.currentPassword !== 'string' || !i.currentPassword) {
    throw new HttpError(400, 'currentPassword is required.');
  }
  return i.currentPassword;
}

export function validatePasswordChangeInput(input: unknown): PasswordChange {
  const currentPassword = validateCurrentPasswordInput(input);
  const i = input as Record<string, unknown>;
  if (typeof i.newPassword !== 'string' || i.newPassword.length < MIN_PASSWORD_LENGTH || i.newPassword.length > MAX_PASSWORD_LENGTH) {
    throw new HttpError(400, `newPassword must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.`);
  }
  return { currentPassword, newPassword: i.newPassword, totpCode: typeof i.totpCode === 'string' ? i.totpCode : undefined };
}

// Loose on purpose - the verify endpoint tries the input as a TOTP code, then falls back to
// treating it as a backup code, rather than the client declaring which kind it's sending. Covers
// both a bare 6-digit code and a dash-grouped backup code (e.g. "A3F9-K2M8-XQ7Z").
const TWO_FACTOR_CODE_RE = /^[A-Za-z0-9-]{6,24}$/;

export function validateTwoFactorCodeInput(input: unknown): string {
  if (typeof input !== 'object' || input === null) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  const i = input as Record<string, unknown>;
  const code = typeof i.code === 'string' ? i.code.trim() : '';
  if (!TWO_FACTOR_CODE_RE.test(code)) {
    throw new HttpError(400, 'code is required.');
  }
  return code;
}

// Same style as USERNAME_RE above - a user-facing label ("YubiKey", "MacBook Touch ID"), not an
// OS identifier of any kind.
const PASSKEY_NAME_RE = /^[\x20-\x7e]{1,64}$/;

export function validatePasskeyNameInput(input: unknown): string {
  if (typeof input !== 'object' || input === null) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  const i = input as Record<string, unknown>;
  const name = typeof i.name === 'string' ? i.name.trim() : '';
  if (!PASSKEY_NAME_RE.test(name)) {
    throw new HttpError(400, 'name must be 1-64 printable characters.');
  }
  return name;
}

// Same shape as PASSKEY_NAME_RE - a user-facing label for an API token (e.g. "laptop cli"), not an
// OS identifier.
const API_TOKEN_NAME_RE = /^[\x20-\x7e]{1,64}$/;

export function validateApiTokenNameInput(input: unknown): string {
  if (typeof input !== 'object' || input === null) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  const i = input as Record<string, unknown>;
  const name = typeof i.name === 'string' ? i.name.trim() : '';
  if (!API_TOKEN_NAME_RE.test(name)) {
    throw new HttpError(400, 'name must be 1-64 printable characters.');
  }
  return name;
}

// Defaults to 'full' when omitted - the only scope that existed before this concept did, so a
// caller that doesn't say otherwise gets the same behavior as always.
export function validateApiTokenScopeInput(input: unknown): ApiTokenScope {
  const i = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  if (i.scope === undefined) return 'full';
  if (i.scope === 'full' || i.scope === 'read-only') return i.scope;
  throw new HttpError(400, "scope must be 'full' or 'read-only'.");
}
