import { realpath } from 'node:fs/promises';
import { PathSandbox, SandboxError, assertValidSegmentName as sharedAssertValidSegmentName, isMountPoint as sharedIsMountPoint } from '@nonraid/shared/path-sandbox';
import type { ResolvedPath as SharedResolvedPath } from '@nonraid/shared/path-sandbox';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';

// Thin wrapper over @nonraid/shared/path-sandbox, preserving every call
// site's existing signature - this file's own traversal/symlink-escape
// logic (and its unit tests) now live in the shared package, since
// share-server needs the identical guarantee, rooted at a share's own
// root_path instead of the fixed /mnt browse root. This wrapper's only
// remaining job is: cache the one resolved root this whole backend process
// uses, and translate the shared package's process-agnostic SandboxError
// into this app's own HttpError so every existing catch site keeps working
// unchanged.

export type ResolvedPath = SharedResolvedPath;

export function assertValidSegmentName(name: unknown): asserts name is string {
  try {
    sharedAssertValidSegmentName(name);
  } catch (err) {
    throw toHttpError(err);
  }
}

function toHttpError(err: unknown): HttpError {
  if (err instanceof SandboxError) return new HttpError(err.status, err.message);
  return err instanceof Error ? new HttpError(500, err.message) : new HttpError(500, String(err));
}

/**
 * A directory whose device id differs from its parent's is a mount point -
 * a share's own root (bind-mounted or mergerfs-pooled, see
 * shares/applier/realApplier.ts) or an array disk's own filesystem
 * (/mnt/disk1, etc). The OS refuses to rmdir/rename over an active mount
 * (EBUSY), so operations that would do that should say so clearly up front
 * instead of surfacing that raw error.
 */
export async function isMountPoint(absPath: string): Promise<boolean> {
  return sharedIsMountPoint(absPath);
}

// Resolved once and cached - /mnt isn't expected to move during the process's
// lifetime. Not cached on failure, so a backend started before disks are
// mounted will pick it up on a later request rather than staying broken.
let cachedRoot: string | null = null;
let cachedSandbox: PathSandbox | null = null;

async function sandbox(): Promise<PathSandbox> {
  if (cachedSandbox && cachedRoot) return cachedSandbox;
  let root: string;
  try {
    root = await realpath(config.browseRoot);
  } catch {
    throw new HttpError(500, `Browse root "${config.browseRoot}" does not exist or is not mounted.`);
  }
  cachedRoot = root;
  cachedSandbox = new PathSandbox(root, config.browseDefaultPath);
  return cachedSandbox;
}

/**
 * Resolves an untrusted path against the fixed browse root (config.browseRoot,
 * "/mnt" by default) and verifies the fully-resolved (symlink-followed) target
 * is still inside that root - "/mnt" is the highest directory reachable from
 * here, matching the file browser's own traversal ceiling. This is the only
 * function that should ever turn a request path into a filesystem path - every
 * browse operation (list, download, rename, move, delete, upload) goes through
 * here or `resolveForCreate`, so a crafted "/etc" or an in-tree symlink
 * pointing outside /mnt can't reach anything beyond the browse root.
 *
 * An empty/missing path resolves to config.browseDefaultPath ("/mnt/user") -
 * the file browser's starting point.
 */
export async function resolveExisting(requestPath: string): Promise<ResolvedPath> {
  try {
    return await (await sandbox()).resolveExisting(requestPath);
  } catch (err) {
    throw toHttpError(err);
  }
}

/**
 * Resolves a location for something that does not exist yet. The parent
 * directory must already exist inside the browse root (checked via
 * `resolveExisting`, so it inherits the same symlink-escape protection); the
 * final segment is validated as a plain name, never a traversal.
 */
export async function resolveForCreate(parentPath: string, newName: unknown): Promise<ResolvedPath> {
  try {
    return await (await sandbox()).resolveForCreate(parentPath, newName);
  } catch (err) {
    throw toHttpError(err);
  }
}
