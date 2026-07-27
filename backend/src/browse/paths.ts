import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';

const SHARE_NAME_RE = /^[A-Za-z0-9_-]+$/;

function assertValidShareName(shareName: string): void {
  if (!SHARE_NAME_RE.test(shareName)) {
    throw new HttpError(400, 'Invalid share name.');
  }
}

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

async function realShareRoot(shareName: string): Promise<string> {
  assertValidShareName(shareName);
  const root = path.join(config.shareMountRoot, shareName);
  try {
    return await realpath(root);
  } catch {
    throw new HttpError(404, `Share "${shareName}" is not mounted.`);
  }
}

export interface ResolvedPath {
  root: string;
  absPath: string;
}

/**
 * Resolves an untrusted relative path against a share's real (symlink-followed) root
 * and verifies the fully-resolved target is still inside that root. This is the only
 * function that should ever turn a request path into a filesystem path — every browse
 * operation (list, download, rename, move, delete, upload) goes through here or
 * `resolveForCreate` so a crafted `../../etc` or an in-share symlink pointing outside
 * the mount can't reach anything beyond the share root.
 */
export async function resolveExisting(shareName: string, relPath: string): Promise<ResolvedPath> {
  const root = await realShareRoot(shareName);
  const cleaned = String(relPath ?? '').replace(/^[/\\]+/, '');
  const joined = path.normalize(path.join(root, cleaned));
  if (!withinRoot(root, joined)) {
    throw new HttpError(400, 'Path escapes the share root.');
  }

  let real: string;
  try {
    real = await realpath(joined);
  } catch {
    throw new HttpError(404, 'File or directory not found.');
  }
  if (!withinRoot(root, real)) {
    throw new HttpError(400, 'Path escapes the share root.');
  }
  return { root, absPath: real };
}

/**
 * Resolves a location for something that does not exist yet. The parent directory
 * must already exist inside the share (checked via `resolveExisting`, so it inherits
 * the same symlink-escape protection); the final segment is validated as a plain
 * name, never a traversal.
 */
export async function resolveForCreate(shareName: string, parentRelPath: string, newName: unknown): Promise<ResolvedPath> {
  assertValidSegmentName(newName);
  const { root, absPath: parentAbs } = await resolveExisting(shareName, parentRelPath);
  const target = path.join(parentAbs, newName);
  if (!withinRoot(root, target)) {
    throw new HttpError(400, 'Path escapes the share root.');
  }
  return { root, absPath: target };
}

export function relativeTo(root: string, absPath: string): string {
  const rel = path.relative(root, absPath);
  return rel === '' ? '' : rel.split(path.sep).join('/');
}
