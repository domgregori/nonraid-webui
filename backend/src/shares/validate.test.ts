import { describe, expect, it } from 'vitest';
import { HttpError } from '../httpError.js';
import { validateShareInput } from './validate.js';

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

const validBase = {
  name: 'media',
  disks: [1, 2],
  allocationMethod: 'most-free',
  protocols: ['smb', 'nfs'],
};

describe('validateShareInput', () => {
  it('accepts a valid share input', () => {
    const result = validateShareInput({ ...validBase, description: '  Movies  ' });
    expect(result).toEqual({
      name: 'media',
      disks: [1, 2],
      allDisks: false,
      allocationMethod: 'most-free',
      protocols: ['smb', 'nfs'],
      smb: undefined,
      nfs: undefined,
      description: 'Movies',
    });
  });

  it('accepts an empty protocol list (no export configured)', () => {
    const result = validateShareInput({ ...validBase, protocols: [] });
    expect(result.protocols).toEqual([]);
  });

  it('rejects a non-object body', () => {
    expectHttpError(() => validateShareInput(null), 400, 'JSON object');
  });

  it('rejects a share name that is empty', () => {
    expectHttpError(() => validateShareInput({ ...validBase, name: '' }), 400, 'Share name');
  });

  it('rejects a share name over 32 characters', () => {
    expectHttpError(() => validateShareInput({ ...validBase, name: 'a'.repeat(33) }), 400, 'Share name');
  });

  it('rejects a share name with spaces', () => {
    expectHttpError(() => validateShareInput({ ...validBase, name: 'my share' }), 400, 'Share name');
  });

  it('rejects a share name with illegal characters', () => {
    expectHttpError(() => validateShareInput({ ...validBase, name: 'media!' }), 400, 'Share name');
  });

  it('rejects an unknown allocation method', () => {
    expectHttpError(() => validateShareInput({ ...validBase, allocationMethod: 'round-robin' }), 400, 'allocationMethod');
  });

  it('rejects a non-string allocation method', () => {
    expectHttpError(() => validateShareInput({ ...validBase, allocationMethod: 42 }), 400, 'allocationMethod');
  });

  it('accepts every documented allocation method', () => {
    for (const allocationMethod of ['most-free', 'fill-up', 'high-water', 'single-disk', 'cache-only']) {
      const input =
        allocationMethod === 'cache-only'
          ? { ...validBase, allocationMethod, disks: [] }
          : allocationMethod === 'single-disk'
            ? { ...validBase, allocationMethod, disks: [1] }
            : { ...validBase, allocationMethod };
      expect(validateShareInput(input).allocationMethod).toBe(allocationMethod);
    }
  });

  it('rejects cache-only with data disks', () => {
    expectHttpError(() => validateShareInput({ ...validBase, allocationMethod: 'cache-only', disks: [1] }), 400, 'zero data disks');
  });

  it('rejects non-cache allocation with no disks', () => {
    expectHttpError(() => validateShareInput({ ...validBase, disks: [] }), 400, 'at least one data disk');
  });

  it('rejects a disk slot below 1 or above 28', () => {
    expectHttpError(() => validateShareInput({ ...validBase, disks: [0] }), 400, 'data disk slot');
    expectHttpError(() => validateShareInput({ ...validBase, disks: [29] }), 400, 'data disk slot');
  });

  it('rejects a non-integer disk slot', () => {
    expectHttpError(() => validateShareInput({ ...validBase, disks: [1.5] }), 400, 'data disk slot');
  });

  it('rejects single-disk allocation with more than one disk', () => {
    expectHttpError(() => validateShareInput({ ...validBase, allocationMethod: 'single-disk', disks: [1, 2] }), 400, 'exactly one disk');
  });

  it('rejects a non-boolean allDisks', () => {
    expectHttpError(() => validateShareInput({ ...validBase, allDisks: 'yes' }), 400, 'allDisks must be a boolean');
  });

  it('rejects allDisks combined with single-disk allocation', () => {
    expectHttpError(() => validateShareInput({ ...validBase, allocationMethod: 'single-disk', disks: [1], allDisks: true }), 400, 'allDisks cannot be combined');
  });

  it('rejects allDisks combined with cache-only allocation', () => {
    expectHttpError(() => validateShareInput({ ...validBase, allocationMethod: 'cache-only', disks: [], allDisks: true }), 400, 'allDisks cannot be combined');
  });

  it('rejects an unknown protocol', () => {
    expectHttpError(() => validateShareInput({ ...validBase, protocols: ['ftp'] }), 400, 'protocols');
  });

  it('rejects protocols that is not an array', () => {
    expectHttpError(() => validateShareInput({ ...validBase, protocols: 'smb' }), 400, 'protocols');
  });

  it('rejects a non-string description', () => {
    expectHttpError(() => validateShareInput({ ...validBase, description: 42 }), 400, 'description must be a string');
  });

  it('truncates a description to 200 characters', () => {
    const result = validateShareInput({ ...validBase, description: 'x'.repeat(500) });
    expect(result.description).toBe('x'.repeat(200));
  });

  it('passes smb/nfs config through unmodified', () => {
    const result = validateShareInput({ ...validBase, smb: { public: true }, nfs: { allowedHosts: ['10.0.0.0/8'], readOnly: true } });
    expect(result.smb).toEqual({ public: true });
    expect(result.nfs).toEqual({ allowedHosts: ['10.0.0.0/8'], readOnly: true });
  });
});
