import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeElevatedAccessReasons, isAllowedBindPath, isAllowedDevicePath, sanitizeContainerName } from './planning.js';

describe('sanitizeContainerName', () => {
  it('trims whitespace and keeps a valid name unchanged', () => {
    expect(sanitizeContainerName('  my-app  ', 'fallback')).toBe('my-app');
  });

  it('replaces illegal characters with dashes', () => {
    expect(sanitizeContainerName('My App', 'fallback')).toBe('My-App');
    expect(sanitizeContainerName('my app!!', 'fallback')).toBe('my-app--');
  });

  it('keeps dots, underscores and digits', () => {
    expect(sanitizeContainerName('my.weird_name-1', 'fallback')).toBe('my.weird_name-1');
  });

  it('allows a name starting with a digit', () => {
    expect(sanitizeContainerName('42answer', 'fallback')).toBe('42answer');
  });

  it('falls back when the cleaned name does not start with an alphanumeric', () => {
    expect(sanitizeContainerName('!!!', 'fallback')).toBe('container-fallback');
    expect(sanitizeContainerName('-foo', 'fallback')).toBe('container-fallback');
    expect(sanitizeContainerName('   ', 'fallback')).toBe('container-fallback');
    expect(sanitizeContainerName('', 'fallback')).toBe('container-fallback');
  });

  it('uses the fallback argument verbatim', () => {
    expect(sanitizeContainerName('!!!', 'cif-123')).toBe('container-cif-123');
  });
});

describe('computeElevatedAccessReasons', () => {
  const base = { privileged: false, network: 'bridge', allowedDeviceHostPaths: [] };

  it('returns no reasons for a fully isolated container', () => {
    expect(computeElevatedAccessReasons(base, 'This container')).toEqual([]);
  });

  it('flags privileged mode', () => {
    const reasons = computeElevatedAccessReasons({ ...base, privileged: true }, 'This template');
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('This template');
    expect(reasons[0]).toContain('privileged');
  });

  it('flags host networking', () => {
    const reasons = computeElevatedAccessReasons({ ...base, network: 'host' }, 'This container');
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('host networking');
  });

  it('flags every passed-through device path', () => {
    const reasons = computeElevatedAccessReasons({ ...base, allowedDeviceHostPaths: ['/dev/sdb', '/dev/sdc'] }, 'This container');
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toContain('/dev/sdb');
    expect(reasons[1]).toContain('/dev/sdc');
  });

  it('combines all three escalation classes', () => {
    const reasons = computeElevatedAccessReasons(
      { privileged: true, network: 'host', allowedDeviceHostPaths: ['/dev/sdb'] },
      'This container',
    );
    expect(reasons).toHaveLength(3);
  });
});

describe('isAllowedDevicePath', () => {
  it('accepts /dev/ paths', () => {
    expect(isAllowedDevicePath('/dev/sda')).toBe(true);
    expect(isAllowedDevicePath('/dev/')).toBe(true);
  });

  it('rejects paths outside /dev/', () => {
    expect(isAllowedDevicePath('/devices/sda')).toBe(false);
    expect(isAllowedDevicePath('/etc/passwd')).toBe(false);
    expect(isAllowedDevicePath('dev/sda')).toBe(false);
  });
});

describe('isAllowedBindPath', () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    const base = mkdtempSync(path.join(tmpdir(), 'planning-test-'));
    root = path.join(base, 'mnt', 'user');
    outside = path.join(base, 'outside');
    mkdirSync(path.join(root, 'share'), { recursive: true });
    mkdirSync(outside, { recursive: true });
  });

  afterEach(() => {
    rmSync(path.dirname(root), { recursive: true, force: true });
  });

  it('allows an existing path inside the root', async () => {
    expect(await isAllowedBindPath(path.join(root, 'share'), [root])).toBe(true);
  });

  it('allows a not-yet-existing path inside the root', async () => {
    expect(await isAllowedBindPath(path.join(root, 'newshare', 'deep', 'file'), [root])).toBe(true);
  });

  it('rejects a path outside the roots', async () => {
    expect(await isAllowedBindPath(path.join(outside, 'file'), [root])).toBe(false);
  });

  it('rejects a path that climbs out of the root with ..', async () => {
    const escape = path.join(root, '..', '..', 'outside', 'file');
    expect(await isAllowedBindPath(escape, [root])).toBe(false);
  });

  it('rejects an empty path', async () => {
    expect(await isAllowedBindPath('', [root])).toBe(false);
  });

  it('rejects a symlink that escapes the root', async () => {
    const link = path.join(root, 'escape');
    symlinkSync(outside, link);
    expect(await isAllowedBindPath(path.join(link, 'secret'), [root])).toBe(false);
  });

  it('allows a symlink whose target stays inside the root', async () => {
    const link = path.join(root, 'link');
    symlinkSync(path.join(root, 'share'), link);
    expect(await isAllowedBindPath(path.join(link, 'file'), [root])).toBe(true);
  });

  it('rejects when no root is given', async () => {
    expect(await isAllowedBindPath(path.join(root, 'share'), [])).toBe(false);
  });
});
