import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';

/**
 * Thrown by every PathSandbox method instead of this app's own HttpError -
 * this package has no dependency on either process's HTTP layer. Callers
 * (backend/src/browse/paths.ts, share-server's own path resolution) catch
 * this and translate `status`/`message` into whatever error shape their own
 * process uses.
 */
export class SandboxError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SandboxError';
    this.status = status;
  }
}

// A single path segment for something not yet on disk (upload filename, rename
// target, mkdir name) - never a separator or a traversal token.
export function assertValidSegmentName(name: unknown): asserts name is string {
  if (
    typeof name !== 'string' ||
    !name ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0')
  ) {
    throw new SandboxError(`Invalid name: "${String(name)}"`, 400);
  }
}

function withinRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

export interface ResolvedPath {
  root: string;
  absPath: string;
}

/**
 * A directory whose device id differs from its parent's is a mount point.
 * Root-independent - just a stat comparison, so it isn't a PathSandbox
 * method (nothing here needs a resolved sandbox root to answer this).
 */
export async function isMountPoint(absPath: string): Promise<boolean> {
  const [here, parent] = await Promise.all([stat(absPath), stat(path.dirname(absPath))]);
  return here.dev !== parent.dev;
}

/**
 * Resolves untrusted paths against a fixed, already-resolved root and
 * verifies the fully-resolved (symlink-followed) target is still inside
 * that root. This is the traversal/symlink-escape boundary every browse
 * operation (admin Browse page and, per-share, share-server's public
 * routes) goes through - a crafted "/etc" or an in-tree symlink pointing
 * outside the sandbox root can't reach anything beyond it.
 *
 * `root` must already be a realpath'd absolute path (symlinks resolved) -
 * the caller resolves it once (see backend/src/browse/paths.ts's cached
 * browseRoot()) since re-resolving it on every single call would defeat
 * the point of caching in the first place, and a share's `root_path` is
 * validated at share-creation time the same way.
 */
export class PathSandbox {
  private readonly root: string;
  private readonly defaultPath: string;

  constructor(root: string, defaultPath: string = root) {
    this.root = root;
    this.defaultPath = defaultPath;
  }

  get rootPath(): string {
    return this.root;
  }

  private withinRoot(candidate: string): boolean {
    return withinRoot(this.root, candidate);
  }

  /**
   * An empty/missing requestPath resolves to `defaultPath` (constructor
   * arg, defaults to the root itself) - the browse root's starting point.
   */
  async resolveExisting(requestPath: string): Promise<ResolvedPath> {
    const raw = String(requestPath ?? '').trim() || this.defaultPath;
    const joined = path.isAbsolute(raw) ? path.normalize(raw) : path.normalize(path.join(this.root, raw));
    if (!this.withinRoot(joined)) {
      throw new SandboxError('Path escapes the sandbox root.', 400);
    }

    let real: string;
    try {
      real = await realpath(joined);
    } catch {
      throw new SandboxError('File or directory not found.', 404);
    }
    if (!this.withinRoot(real)) {
      throw new SandboxError('Path escapes the sandbox root.', 400);
    }
    return { root: this.root, absPath: real };
  }

  /**
   * Resolves a location for something that does not exist yet. The parent
   * directory must already exist inside the sandbox root (checked via
   * resolveExisting, so it inherits the same symlink-escape protection);
   * the final segment is validated as a plain name, never a traversal.
   */
  async resolveForCreate(parentPath: string, newName: unknown): Promise<ResolvedPath> {
    assertValidSegmentName(newName);
    const { absPath: parentAbs } = await this.resolveExisting(parentPath);
    const target = path.join(parentAbs, newName);
    if (!this.withinRoot(target)) {
      throw new SandboxError('Path escapes the sandbox root.', 400);
    }
    return { root: this.root, absPath: target };
  }
}
