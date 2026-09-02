import { randomUUID } from 'node:crypto';
import type { AllocationMethod } from '../shares/types.js';
import { parseCfg, parsePasswd } from './cfgParser.js';
import { parseDockerTemplate } from './dockerTemplateParser.js';
import type { ImportedFile, ParsedDockerContainer, ParsedShare, ParsedUser, UnraidImportPreview, UnraidImportWarning } from './types.js';

// Real accounts start at 1000 on Unraid (and match this app's own convention) - everything below
// that (root, bin, daemon, sshd, nobody, ...) is a system/service account, never something to
// offer for import. Confirmed against a real flash-drive backup's config/passwd this session.
const MIN_REAL_UID = 1000;

const ALLOCATION_MAP: Record<string, AllocationMethod> = {
  highwater: 'high-water',
  fillup: 'fill-up',
  mostfree: 'most-free',
};

/**
 * Finds the real Unraid `config/` directory among the uploaded files, regardless of how much of
 * the flash drive the admin included - a full `tar` of the whole USB drive roots everything under
 * something like `mnt/usb/config/...`, a folder-picker selection of just the `config` folder
 * itself roots it at `share.cfg` directly, and everything in between is possible too. `share.cfg`
 * is the one file guaranteed to exist and sit directly inside config/ (unlike shares/*.cfg, which
 * doesn't exist at all for a fresh install with zero shares yet), so its own directory is the
 * anchor everything else here is resolved relative to.
 */
function findConfigRoot(files: ImportedFile[]): string | null {
  for (const f of files) {
    const normalized = f.relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized === 'share.cfg' || normalized.endsWith('/share.cfg')) {
      const idx = normalized.lastIndexOf('/');
      return idx === -1 ? '' : normalized.slice(0, idx);
    }
  }
  return null;
}

function relativeTo(root: string, path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (root === '') return normalized;
  return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized;
}

/** Best-effort `shareInclude`/`shareExclude` -> data disk slot numbers, e.g. "disk1,disk3" -> [1, 3].
 *  Returns null (not an empty array) when the field is non-empty but nothing recognizable was
 *  found in it, so the caller can tell "no restriction" apart from "restriction we couldn't map". */
function parseDiskList(value: string): number[] | null {
  if (!value.trim()) return [];
  const matches = [...value.matchAll(/disk(\d+)/gi)].map((m) => Number(m[1]));
  return matches.length > 0 ? matches : null;
}

/** Pulls the share name out of one of Unraid's own `/mnt/user/<share>/...` paths - null if the
 *  path isn't rooted there at all (Docker/VM storage can just as easily point at an unassigned
 *  device or a cache-only path with no share involved, in which case there's nothing to flag). */
function shareNameFromUnraidUserPath(path: string): string | null {
  const match = /^\/mnt\/user\/([^/]+)/.exec(path.trim());
  return match?.[1] ?? null;
}

/**
 * Unraid's own `docker.cfg`/`domain.cfg` declare which share (if any) holds Docker's own image
 * storage and a VM's vdisks/install media - engine-internal state, not portable user data, and
 * not something this app can use directly even once imported (Docker's own storage format isn't
 * this app's overlay2 layout, and this app has no VM feature at all yet - see the LXC/VM
 * distinction noted elsewhere in this codebase). Confirmed live: a real user's "system" share held
 * exactly this - a 20GB `docker.img` and a `libvirt.img`, neither usable as imported, which is what
 * prompted this in the first place.
 *
 * Deliberately read from these two config files rather than hardcoding the literal names
 * "system"/"domains"/"isos" (Unraid's own defaults) - an admin can point any of these at a
 * differently-named share, and trusting Unraid's own declaration is correct in every case a
 * hardcoded guess wouldn't be.
 */
function detectSpecialShares(byRelPath: Map<string, ImportedFile>): Map<string, string[]> {
  const reasons = new Map<string, string[]>();
  const add = (path: string | undefined, reason: string) => {
    const name = path ? shareNameFromUnraidUserPath(path) : null;
    if (!name) return;
    const existing = reasons.get(name) ?? [];
    existing.push(reason);
    reasons.set(name, existing);
  };

  const dockerCfg = byRelPath.get('docker.cfg');
  if (dockerCfg) {
    const raw = parseCfg(dockerCfg.content.toString('utf8'));
    add(raw.DOCKER_IMAGE_FILE, "Docker's own engine storage (docker.img)");
  }
  const domainCfg = byRelPath.get('domain.cfg');
  if (domainCfg) {
    const raw = parseCfg(domainCfg.content.toString('utf8'));
    add(raw.IMAGE_FILE, 'VM engine storage (libvirt.img)');
    add(raw.DOMAINDIR, 'VM virtual disk storage');
    add(raw.MEDIADIR, 'VM installation media');
  }
  return reasons;
}

function parseShare(name: string, raw: Record<string, string>, specialReasons: string[] | undefined, warnings: UnraidImportWarning[]): ParsedShare {
  const rawAllocator = (raw.shareAllocator ?? '').toLowerCase();
  let allocationMethod = ALLOCATION_MAP[rawAllocator];
  if (!allocationMethod) {
    allocationMethod = 'high-water';
    warnings.push({ message: `Share "${name}": unrecognized allocator "${raw.shareAllocator ?? ''}" - defaulting to high-water.` });
  }

  const include = parseDiskList(raw.shareInclude ?? '');
  const exclude = parseDiskList(raw.shareExclude ?? '');
  const diskRestrictionUnmapped = (raw.shareInclude?.trim() && include === null) || (raw.shareExclude?.trim() && exclude === null) || false;
  if (diskRestrictionUnmapped) {
    warnings.push({ message: `Share "${name}": couldn't map its disk include/exclude list - defaulting to all disks. Check disk placement after import.` });
  }

  return {
    name,
    allocationMethod,
    floorGb: Number(raw.shareFloor ?? 0) / 1024 / 1024,
    comment: raw.shareComment ?? '',
    readUsers: (raw.shareReadList ?? '').split(/\s+/).filter(Boolean),
    writeUsers: (raw.shareWriteList ?? '').split(/\s+/).filter(Boolean),
    diskRestrictionUnmapped,
    specialReason: specialReasons && specialReasons.length > 0 ? specialReasons.join(' · ') : null,
  };
}

export function parseUnraidConfig(
  files: ImportedFile[],
): { shares: ParsedShare[]; users: ParsedUser[]; dockerContainers: ParsedDockerContainer[]; warnings: UnraidImportWarning[] } {
  const warnings: UnraidImportWarning[] = [];
  const root = findConfigRoot(files);
  if (root === null) {
    throw new Error('Could not find share.cfg - this doesn\'t look like an Unraid config/ directory (or a backup that includes one).');
  }

  const byRelPath = new Map(files.map((f) => [relativeTo(root, f.relativePath), f]));
  const specialShareReasons = detectSpecialShares(byRelPath);

  const shares: ParsedShare[] = [];
  const dockerContainers: ParsedDockerContainer[] = [];
  for (const [relPath, file] of byRelPath) {
    const shareMatch = /^shares\/([^/]+)\.cfg$/.exec(relPath);
    if (shareMatch?.[1]) {
      shares.push(parseShare(shareMatch[1], parseCfg(file.content.toString('utf8')), specialShareReasons.get(shareMatch[1]), warnings));
      continue;
    }
    if (/^plugins\/dockerMan\/templates-user\/[^/]+\.xml$/.test(relPath)) {
      const parsed = parseDockerTemplate(file.content.toString('utf8'), relPath, warnings);
      if (parsed) dockerContainers.push(parsed);
    }
  }
  shares.sort((a, b) => a.name.localeCompare(b.name));
  dockerContainers.sort((a, b) => a.name.localeCompare(b.name));

  const passwdFile = byRelPath.get('passwd');
  const allAccounts = passwdFile ? parsePasswd(passwdFile.content.toString('utf8')) : [];
  if (!passwdFile) warnings.push({ message: 'No passwd file found - user accounts will not be available to import.' });
  const users: ParsedUser[] = allAccounts.filter((a) => a.uid >= MIN_REAL_UID).sort((a, b) => a.username.localeCompare(b.username));

  if (shares.length === 0 && dockerContainers.length === 0) {
    warnings.push({ message: 'No share configs or docker container templates found - nothing to import there.' });
  }

  return { shares, users, dockerContainers, warnings };
}

export function buildPreview(files: ImportedFile[]): UnraidImportPreview {
  const { shares, users, dockerContainers, warnings } = parseUnraidConfig(files);
  return { token: randomUUID(), shares, users, dockerContainers, warnings };
}
