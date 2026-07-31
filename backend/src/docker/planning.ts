import path from 'node:path';
import { realpath } from 'node:fs/promises';

/**
 * Resolves an absolute host path against the allowed root directories.
 * Uses path.resolve('/', ...) so `..` segments can't climb out of a root —
 * caller-supplied paths (a CA template's defaults, or a manually-typed
 * volume) are treated as untrusted input, not just UX hints.
 *
 * A string-only check isn't enough: a symlink sitting under an allowed root
 * (e.g. `/mnt/user/someshare/escape -> /etc`) can look compliant while its
 * real mount target is outside every root, and Docker's bind mounts follow
 * host-side symlinks at mount time. So once the string check passes, walk up
 * to the nearest existing ancestor (the target may not exist yet — Docker
 * creates missing bind sources), resolve it through `realpath`, and re-check
 * containment on the real path. Mirrors `browse/paths.ts`'s `resolveExisting`,
 * which does the same thing for file-browser paths.
 */
export async function isAllowedBindPath(hostPath: string, roots: string[]): Promise<boolean> {
  if (!hostPath) return false;

  const normalizedRoots = roots.map((root) => path.resolve('/', root));
  const withinRoots = (candidate: string) =>
    normalizedRoots.some((root) => candidate === root || candidate.startsWith(`${root}/`));

  const resolved = path.resolve('/', hostPath);
  if (!withinRoots(resolved)) return false;

  let probe = resolved;
  for (;;) {
    try {
      const real = await realpath(probe);
      const tail = path.relative(probe, resolved);
      const effective = tail ? path.resolve(real, tail) : real;
      return withinRoots(real) && withinRoots(effective);
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return false; // walked all the way to '/' without finding anything real
      probe = parent;
    }
  }
}

export function isAllowedDevicePath(hostPath: string): boolean {
  return hostPath.startsWith('/dev/');
}

export function sanitizeContainerName(raw: string, fallback: string): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_.-]/g, '-');
  if (/^[a-zA-Z0-9]/.test(cleaned)) return cleaned;
  return `container-${fallback}`;
}

/**
 * Privileged mode, host networking, and raw device passthrough are all
 * host-isolation escapes of comparable severity — each needs the same
 * explicit human confirmation before install/create proceeds, not just a
 * silent pass through the narrower checks above (path allow-list, /dev/
 * prefix). `subject` lets callers phrase it for what's actually being
 * created ("This template" for a CA install, "This container" for a
 * manually-configured one).
 */
export function computeElevatedAccessReasons(
  input: { privileged: boolean; network: string; allowedDeviceHostPaths: string[] },
  subject: string,
): string[] {
  const reasons: string[] = [];
  if (input.privileged) reasons.push(`${subject} runs a privileged container (full host access).`);
  for (const hostPath of input.allowedDeviceHostPaths) {
    reasons.push(`${subject} passes through host device "${hostPath}" directly.`);
  }
  if (input.network === 'host') reasons.push(`${subject} uses host networking (no network isolation from the host).`);
  return reasons;
}
