import { HttpError } from '../httpError.js';
import type { GroupInput, UserInput, UserUpdateInput } from './types.js';

// Standard Linux useradd/groupadd naming rules.
const NAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const MIN_PASSWORD_LENGTH = 8;

function validatePassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  return password;
}

function validateGroups(groups: unknown): string[] {
  if (!Array.isArray(groups) || !groups.every((g) => typeof g === 'string' && NAME_RE.test(g))) {
    throw new HttpError(400, 'groups must be an array of valid group names.');
  }
  return groups;
}

export function validateUserInput(input: unknown): UserInput {
  if (typeof input !== 'object' || input === null) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  const i = input as Record<string, unknown>;

  if (typeof i.username !== 'string' || !NAME_RE.test(i.username)) {
    throw new HttpError(400, 'Username must be 1-32 characters: lowercase letters, numbers, dash, underscore; cannot start with a digit or dash.');
  }

  return {
    username: i.username,
    password: validatePassword(i.password),
    groups: i.groups === undefined ? [] : validateGroups(i.groups),
  };
}

export function validateUserUpdateInput(input: unknown): UserUpdateInput {
  if (typeof input !== 'object' || input === null) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  const i = input as Record<string, unknown>;

  const result: UserUpdateInput = {};
  if (i.password !== undefined) result.password = validatePassword(i.password);
  if (i.groups !== undefined) result.groups = validateGroups(i.groups);
  return result;
}

export function validateGroupInput(input: unknown): GroupInput {
  if (typeof input !== 'object' || input === null) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  const i = input as Record<string, unknown>;

  if (typeof i.name !== 'string' || !NAME_RE.test(i.name)) {
    throw new HttpError(400, 'Group name must be 1-32 characters: lowercase letters, numbers, dash, underscore; cannot start with a digit or dash.');
  }
  return { name: i.name };
}

const PERMISSIONS = ['read-write', 'read-only', 'none', 'hidden'] as const;

export function validatePermission(value: unknown): (typeof PERMISSIONS)[number] {
  if (typeof value !== 'string' || !PERMISSIONS.includes(value as (typeof PERMISSIONS)[number])) {
    throw new HttpError(400, `permission must be one of: ${PERMISSIONS.join(', ')}`);
  }
  return value as (typeof PERMISSIONS)[number];
}
