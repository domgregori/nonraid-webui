import { PathSandbox } from '@nonraid/shared/path-sandbox';

const cache = new Map<string, PathSandbox>();

/**
 * One PathSandbox per share id, rooted at whatever root_path the RPC just revealed for that
 * specific share - never re-validated against the filesystem beyond what PathSandbox's own
 * resolveExisting() does per call (root_path was already validated as a real, resolvable
 * directory inside the browse root at share-creation time, by the admin backend's own
 * resolveExisting() - see backend/src/shareLinks/service.ts's create()). Recreated if a share's
 * rootPath ever legitimately changes (it can't today - there's no admin route to edit it after
 * creation - but this stays correct rather than silently stale if that's ever added).
 */
export function getPathSandbox(shareId: string, rootPath: string): PathSandbox {
  const existing = cache.get(shareId);
  if (existing && existing.rootPath === rootPath) return existing;
  const sandbox = new PathSandbox(rootPath);
  cache.set(shareId, sandbox);
  return sandbox;
}
