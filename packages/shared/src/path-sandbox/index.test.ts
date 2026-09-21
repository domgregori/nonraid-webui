import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { PathSandbox, SandboxError, assertValidSegmentName, isMountPoint } from './index.js';

describe('PathSandbox', () => {
  let tmpRoot: string;
  let sandboxRoot: string; // realpath'd - matches what the real caller passes in
  let outside: string;

  before(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'nonraid-sandbox-test-'));
    await mkdir(path.join(tmpRoot, 'root', 'sub'), { recursive: true });
    await mkdir(path.join(tmpRoot, 'outside'), { recursive: true });
    await writeFile(path.join(tmpRoot, 'root', 'file.txt'), 'hello');
    await writeFile(path.join(tmpRoot, 'outside', 'secret.txt'), 'nope');
    sandboxRoot = await realpath(path.join(tmpRoot, 'root'));
    outside = await realpath(path.join(tmpRoot, 'outside'));
  });

  after(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('resolves a plain relative path inside the root', async () => {
    const sandbox = new PathSandbox(sandboxRoot);
    const { absPath } = await sandbox.resolveExisting('file.txt');
    assert.equal(absPath, path.join(sandboxRoot, 'file.txt'));
  });

  it('resolves the root itself for an empty path', async () => {
    const sandbox = new PathSandbox(sandboxRoot);
    const { absPath } = await sandbox.resolveExisting('');
    assert.equal(absPath, sandboxRoot);
  });

  it('rejects a classic ../ traversal attempt', async () => {
    const sandbox = new PathSandbox(sandboxRoot);
    await assert.rejects(() => sandbox.resolveExisting('../outside/secret.txt'), (err: unknown) => {
      assert.ok(err instanceof SandboxError);
      assert.equal(err.status, 400);
      return true;
    });
  });

  it('rejects a deep ../../.. traversal attempt', async () => {
    const sandbox = new PathSandbox(sandboxRoot);
    await assert.rejects(() => sandbox.resolveExisting('sub/../../../../../../etc/passwd'));
  });

  it('rejects an absolute path escaping the root', async () => {
    const sandbox = new PathSandbox(sandboxRoot);
    await assert.rejects(() => sandbox.resolveExisting('/etc/passwd'));
  });

  it('rejects a symlink that resolves outside the root (symlink-escape)', async () => {
    const linkPath = path.join(tmpRoot, 'root', 'escape-link');
    await symlink(outside, linkPath, 'dir');
    const sandbox = new PathSandbox(sandboxRoot);
    await assert.rejects(() => sandbox.resolveExisting('escape-link'), (err: unknown) => {
      assert.ok(err instanceof SandboxError);
      assert.equal(err.status, 400);
      return true;
    });
  });

  it('rejects a symlink to a file outside the root', async () => {
    const linkPath = path.join(tmpRoot, 'root', 'escape-file-link');
    await symlink(path.join(outside, 'secret.txt'), linkPath, 'file');
    const sandbox = new PathSandbox(sandboxRoot);
    await assert.rejects(() => sandbox.resolveExisting('escape-file-link'));
  });

  it('allows a symlink that resolves back inside the root', async () => {
    const linkPath = path.join(tmpRoot, 'root', 'inside-link');
    await symlink(path.join(sandboxRoot, 'file.txt'), linkPath, 'file');
    const sandbox = new PathSandbox(sandboxRoot);
    const { absPath } = await sandbox.resolveExisting('inside-link');
    assert.equal(absPath, path.join(sandboxRoot, 'file.txt'));
  });

  it('404s on a path that does not exist', async () => {
    const sandbox = new PathSandbox(sandboxRoot);
    await assert.rejects(() => sandbox.resolveExisting('does-not-exist.txt'), (err: unknown) => {
      assert.ok(err instanceof SandboxError);
      assert.equal(err.status, 404);
      return true;
    });
  });

  it('resolveForCreate rejects a traversal segment name', async () => {
    const sandbox = new PathSandbox(sandboxRoot);
    await assert.rejects(() => sandbox.resolveForCreate('', '../escape.txt'));
    await assert.rejects(() => sandbox.resolveForCreate('', '..'));
    await assert.rejects(() => sandbox.resolveForCreate('', '.'));
  });

  it('resolveForCreate rejects a segment name containing a separator', async () => {
    const sandbox = new PathSandbox(sandboxRoot);
    await assert.rejects(() => sandbox.resolveForCreate('', 'sub/evil.txt'));
    await assert.rejects(() => sandbox.resolveForCreate('', 'sub\\evil.txt'));
  });

  it('resolveForCreate rejects a null-byte segment name', async () => {
    const sandbox = new PathSandbox(sandboxRoot);
    await assert.rejects(() => sandbox.resolveForCreate('', 'evil\0.txt'));
  });

  it('resolveForCreate accepts a plain new name under an existing parent', async () => {
    const sandbox = new PathSandbox(sandboxRoot);
    const { absPath } = await sandbox.resolveForCreate('sub', 'newfile.txt');
    assert.equal(absPath, path.join(sandboxRoot, 'sub', 'newfile.txt'));
  });

  it('uses a custom defaultPath for an empty request path when given one', async () => {
    const defaultPath = path.join(sandboxRoot, 'sub');
    const sandbox = new PathSandbox(sandboxRoot, defaultPath);
    const { absPath } = await sandbox.resolveExisting('');
    assert.equal(absPath, defaultPath);
  });
});

describe('assertValidSegmentName', () => {
  it('accepts a plain filename', () => {
    assert.doesNotThrow(() => assertValidSegmentName('report.pdf'));
  });

  for (const bad of ['.', '..', '', 'a/b', 'a\\b', 'a\0b', undefined, null, 42]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      assert.throws(() => assertValidSegmentName(bad), SandboxError);
    });
  }
});

describe('isMountPoint', () => {
  it('returns false for a plain subdirectory on the same filesystem', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'nonraid-mp-test-'));
    try {
      const sub = path.join(tmp, 'sub');
      await mkdir(sub);
      assert.equal(await isMountPoint(sub), false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
