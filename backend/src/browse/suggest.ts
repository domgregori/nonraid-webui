import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

/**
 * Resolves `dir` against one of `roots`, symlink-safe — a string-prefix check
 * alone can't catch an in-tree symlink pointing outside every allowed root
 * (same reasoning as docker/planning.ts's isAllowedBindPath). Returns the
 * pre-realpath absolute form, once the real target is confirmed safe, so
 * suggestions echo back what's actually on screen rather than a resolved
 * symlink target.
 */
async function resolveDirWithinRoots(dir: string, roots: string[]): Promise<string | null> {
  const normalizedRoots = roots.map((root) => path.resolve('/', root));
  const withinRoots = (candidate: string) => normalizedRoots.some((root) => candidate === root || candidate.startsWith(`${root}/`));

  const resolved = path.resolve('/', dir);
  if (!withinRoots(resolved)) return null;

  try {
    const real = await realpath(resolved);
    return withinRoots(real) ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * Directory-only path completion for a host-path textbox (Docker/Apps bind
 * mounts, backup destination, Browse page's move dialog) — never files, since
 * every current caller is choosing a destination *directory*, not a file.
 * Purely a UX hint: the real safety check happens again at submit time
 * (isAllowedBindPath for binds, resolveExisting for browse), so a suggestion
 * going stale between here and submit (a directory renamed or removed
 * meanwhile) is never a security concern, just a stale suggestion.
 */
export async function suggestDirectories(partial: string, roots: string[], limit = 20): Promise<string[]> {
  const raw = String(partial ?? '');
  const endsWithSlash = raw.endsWith('/');
  const dirRaw = !raw ? (roots[0] ?? '/') : endsWithSlash ? raw : path.dirname(raw);
  const prefix = endsWithSlash || !raw ? '' : path.basename(raw);

  const safeDir = await resolveDirWithinRoots(dirRaw, roots);
  if (safeDir === null) return [];

  let dirents;
  try {
    dirents = await readdir(safeDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const lowerPrefix = prefix.toLowerCase();
  return dirents
    .filter((d) => d.isDirectory() && d.name.toLowerCase().startsWith(lowerPrefix))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit)
    .map((name) => path.join(safeDir, name));
}
