import { describe, expect, it } from 'vitest';
import { HttpError } from '../httpError.js';
import { validateGroupInput, validatePermission, validateUserInput, validateUserUpdateInput } from './validate.js';

function expectHttpError(fn: () => unknown, status: number, messagePart: string): void {
  try {
    fn();
    throw new Error('expected to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(status);
    expect((err as HttpError).message).toContain(messagePart);
  }
}

describe('validateUserInput', () => {
  it('accepts a valid user with lowercase username and 8+ char password', () => {
    const result = validateUserInput({ username: 'alice', password: 'hunter2secret', groups: ['family'] });
    expect(result).toEqual({ username: 'alice', password: 'hunter2secret', groups: ['family'] });
  });

  it('accepts an underscore-leading username', () => {
    expect(validateUserInput({ username: '_alice', password: 'hunter2secret' }).username).toBe('_alice');
  });

  it('defaults groups to [] when omitted', () => {
    const result = validateUserInput({ username: 'alice', password: 'hunter2secret' });
    expect(result.groups).toEqual([]);
  });

  it('rejects a non-object body', () => {
    expectHttpError(() => validateUserInput('alice'), 400, 'JSON object');
  });

  it('rejects an uppercase username', () => {
    expectHttpError(() => validateUserInput({ username: 'Alice', password: 'hunter2secret' }), 400, 'Username');
  });

  it('rejects a username starting with a digit', () => {
    expectHttpError(() => validateUserInput({ username: '1alice', password: 'hunter2secret' }), 400, 'Username');
  });

  it('rejects a username starting with a dash', () => {
    expectHttpError(() => validateUserInput({ username: '-alice', password: 'hunter2secret' }), 400, 'Username');
  });

  it('rejects a username over 32 characters', () => {
    expectHttpError(() => validateUserInput({ username: 'a'.repeat(33), password: 'hunter2secret' }), 400, 'Username');
  });

  it('rejects a password shorter than 8 characters', () => {
    expectHttpError(() => validateUserInput({ username: 'alice', password: 'short' }), 400, 'at least 8 characters');
  });

  it('rejects a non-string password', () => {
    expectHttpError(() => validateUserInput({ username: 'alice', password: 12345678 }), 400, 'at least 8 characters');
  });

  it('rejects groups that is not an array', () => {
    expectHttpError(() => validateUserInput({ username: 'alice', password: 'hunter2secret', groups: 'family' }), 400, 'groups must be an array');
  });

  it('rejects groups containing an invalid group name', () => {
    expectHttpError(() => validateUserInput({ username: 'alice', password: 'hunter2secret', groups: ['Family'] }), 400, 'groups must be an array');
  });
});

describe('validateUserUpdateInput', () => {
  it('accepts an empty update (no fields)', () => {
    expect(validateUserUpdateInput({})).toEqual({});
  });

  it('accepts a password and groups update', () => {
    expect(validateUserUpdateInput({ password: 'newpass123', groups: ['family'] })).toEqual({ password: 'newpass123', groups: ['family'] });
  });

  it('rejects a short password in an update', () => {
    expectHttpError(() => validateUserUpdateInput({ password: 'short' }), 400, 'at least 8 characters');
  });

  it('rejects an invalid groups update', () => {
    expectHttpError(() => validateUserUpdateInput({ groups: [42] }), 400, 'groups must be an array');
  });

  it('rejects a non-object body', () => {
    expectHttpError(() => validateUserUpdateInput(null), 400, 'JSON object');
  });
});

describe('validateGroupInput', () => {
  it('accepts a valid group name', () => {
    expect(validateGroupInput({ name: 'family' })).toEqual({ name: 'family' });
  });

  it('rejects an uppercase group name', () => {
    expectHttpError(() => validateGroupInput({ name: 'Family' }), 400, 'Group name');
  });

  it('rejects a group name with illegal characters', () => {
    expectHttpError(() => validateGroupInput({ name: 'family!' }), 400, 'Group name');
  });

  it('rejects a non-object body', () => {
    expectHttpError(() => validateGroupInput('family'), 400, 'JSON object');
  });
});

describe('validatePermission', () => {
  it('accepts every permission level', () => {
    for (const permission of ['read-write', 'read-only', 'none', 'hidden']) {
      expect(validatePermission(permission)).toBe(permission);
    }
  });

  it('rejects an unknown permission', () => {
    expectHttpError(() => validatePermission('admin'), 400, 'permission must be one of');
  });

  it('rejects a non-string permission', () => {
    expectHttpError(() => validatePermission(123), 400, 'permission must be one of');
  });
});
