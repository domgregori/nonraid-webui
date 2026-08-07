import { HttpError } from '../httpError.js';

// This admin credential has nothing to do with the OS — unlike
// users/validate.ts's NAME_RE, which exists because those become real
// useradd/smbpasswd accounts. Printable ASCII only, trimmed, no Linux
// username constraints.
const USERNAME_RE = /^[\x20-\x7e]{3,64}$/;
const MIN_PASSWORD_LENGTH = 10; // higher than the Samba path's 8 — this credential
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

// Deliberately loose — a bad guess should fail as a generic 401 on the login
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
}

export function validatePasswordChangeInput(input: unknown): PasswordChange {
  if (typeof input !== 'object' || input === null) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  const i = input as Record<string, unknown>;
  if (typeof i.currentPassword !== 'string' || !i.currentPassword) {
    throw new HttpError(400, 'currentPassword is required.');
  }
  if (typeof i.newPassword !== 'string' || i.newPassword.length < MIN_PASSWORD_LENGTH || i.newPassword.length > MAX_PASSWORD_LENGTH) {
    throw new HttpError(400, `newPassword must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.`);
  }
  return { currentPassword: i.currentPassword, newPassword: i.newPassword };
}
