import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';

// A single path segment for something not yet on disk (upload filename, rename
// target, mkdir name) — never a separator or a traversal token.
function assertValidSegmentName(name: unknown): asserts name is string {
  if (
    typeof name !== 'string' ||
    !name ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0')
  ) {
    throw new HttpError(400, `Invalid name: "${String(name)}"`);
  }
}

function withinRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

// Resolved once and cached — /mnt isn't expected to move during the process's
// lifetime. Not cached on failure, so a backend started before disks are
// mounted will pick it up on a later request rather than staying broken.
let cachedRoot: string | null = null;

async function browseRoot(): Promise<string> {
  if (cachedRoot) return cachedRoot;
  try {
    cachedRoot = await realpath(config.browseRoot);
  } catch {
    throw new HttpError(500, `Browse root "${config.browseRoot}" does not exist or is not mounted.`);
  }
  return cachedRoot;
}

export interface ResolvedPath {
  root: string;
  absPath: string;
}

/**
 * Resolves an untrusted path against the fixed browse root (config.browseRoot,
 * "/mnt" by default) and verifies the fully-resolved (symlink-followed) target
 * is still inside that root — "/mnt" is the highest directory reachable from
 * here, matching the file browser's own traversal ceiling. This is the only
 * function that should ever turn a request path into a filesystem path — every
 * browse operation (list, download, rename, move, delete, upload) goes through
 * here or `resolveForCreate`, so a crafted "/etc" or an in-tree symlink
 * pointing outside /mnt can't reach anything beyond the browse root.
 *
 * An empty/missing path resolves to config.browseDefaultPath ("/mnt/user") —
 * the file browser's starting point.
 */
export async function resolveExisting(requestPath: string): Promise<ResolvedPath> {
  const root = await browseRoot();
  const raw = String(requestPath ?? '').trim() || config.browseDefaultPath;
  const joined = path.isAbsolute(raw) ? path.normalize(raw) : path.normalize(path.join(root, raw));
  if (!withinRoot(root, joined)) {
    throw new HttpError(400, 'Path escapes the browse root.');
  }

  let real: string;
  try {
    real = await realpath(joined);
  } catch {
    throw new HttpError(404, 'File or directory not found.');
  }
  if (!withinRoot(root, real)) {
    throw new HttpError(400, 'Path escapes the browse root.');
  }
  return { root, absPath: real };
}

/**
 * Resolves a location for something that does not exist yet. The parent
 * directory must already exist inside the browse root (checked via
 * `resolveExisting`, so it inherits the same symlink-escape protection); the
 * final segment is validated as a plain name, never a traversal.
 */
export async function resolveForCreate(parentPath: string, newName: unknown): Promise<ResolvedPath> {
  assertValidSegmentName(newName);
  const { root, absPath: parentAbs } = await resolveExisting(parentPath);
  const target = path.join(parentAbs, newName);
  if (!withinRoot(root, target)) {
    throw new HttpError(400, 'Path escapes the browse root.');
  }
  return { root, absPath: target };
}
