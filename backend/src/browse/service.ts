import { execFile } from 'node:child_process';
import { copyFile, cp, mkdir, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import type { ShareService } from '../shares/index.js';
import { isMountPoint, resolveExisting, resolveForCreate } from './paths.js';
import type { BrowseCommandResult, BrowseEntry, BrowseListing } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * New content this backend's own root process creates directly (as opposed to a Docker container,
 * Samba, or NFS client writing through their own uid) would otherwise land owned root:root -
 * shares/applier/realApplier.ts's provisionArrayDir() only covers a share/pool directory itself,
 * not files created later inside it. group is already correct for free via the setgid bit
 * provisionArrayDir() sets (Linux propagates it to every new subdirectory automatically), so this
 * only needs to fix the owner.
 */
async function chownArrayOwner(absPath: string, recursive = false): Promise<void> {
  const args = recursive ? ['-R', config.arrayDataOwner, absPath] : [config.arrayDataOwner, absPath];
  await execFileAsync('chown', args);
}

/** Splits an absolute path known to start with `prefix` into the share/pool name (its first
 *  segment past the prefix) and everything after that (possibly empty) - the two arguments
 *  ShareService.locateShareEntries() needs. Shared by both places a browse path can land inside a
 *  pool's data: the merged view at shareMountRoot, and a single disk's own branch of it. */
function splitShareRelDir(prefix: string, absPath: string): { shareName: string; relDir: string } | null {
  if (!absPath.startsWith(prefix)) return null;
  const rel = absPath.slice(prefix.length);
  const slash = rel.indexOf('/');
  const shareName = slash === -1 ? rel : rel.slice(0, slash);
  if (!shareName) return null;
  return { shareName, relDir: slash === -1 ? '' : rel.slice(slash + 1) };
}

/** "/mnt/disk1/" for any absPath under a raw array disk (at any depth - .../media, .../media/sub,
 *  etc.), regardless of what's actually inside it - null everywhere else. Just root's immediate
 *  child, so this doesn't itself confirm anything past that is a real pool; splitShareRelDir()
 *  plus locateShareEntries() returning null handles that. */
function diskBranchPrefix(root: string, absPath: string): string | null {
  const rootPrefix = `${root}/`;
  if (!absPath.startsWith(rootPrefix)) return null;
  const rel = absPath.slice(rootPrefix.length);
  const slash = rel.indexOf('/');
  const firstSegment = slash === -1 ? rel : rel.slice(0, slash);
  return /^disk\d+$/.test(firstSegment) ? `${rootPrefix}${firstSegment}/` : null;
}

/** Browses the whole /mnt tree (config.browseRoot), not a single share - see
 * paths.ts for the traversal-ceiling enforcement every method here relies on. */
export class BrowseService {
  constructor(private shares: ShareService) {}

  async list(requestPath: string): Promise<BrowseListing> {
    const { root, absPath } = await resolveExisting(requestPath);
    const st = await stat(absPath);
    if (!st.isDirectory()) throw new HttpError(400, 'Not a directory.');

    const dirents = await readdir(absPath, { withFileTypes: true });
    const entries: BrowseEntry[] = await Promise.all(
      dirents.map(async (d): Promise<BrowseEntry> => {
        const entryStat = await stat(path.join(absPath, d.name)).catch(() => null);
        return {
          name: d.name,
          type: d.isSymbolicLink() ? 'symlink' : d.isDirectory() ? 'directory' : 'file',
          size: entryStat?.size ?? 0,
          modifiedAt: (entryStat?.mtime ?? new Date(0)).toISOString(),
        };
      }),
    );
    entries.sort((a, b) => {
      if ((a.type === 'directory') !== (b.type === 'directory')) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    // Classify each top-level location by kind, one level above the location itself - lets the UI
    // color-code otherwise identical-looking folders (see BrowseLocationType's own doc comment).
    // Only meaningful at exactly these two depths: /mnt root (raw array disks, the cache pool) and
    // shareMountRoot (individual pools) - anywhere deeper is just regular file/folder content with
    // no location-type distinction to make. Every real location here is a genuine mount point
    // (mergerfs for a pool, the raw disk filesystem, btrfs for cache) - a same-named plain
    // directory that just happens to sit alongside them (e.g. a container's own conventional
    // /mnt/user/appdata, created without going through this app's Pools feature) is NOT one, and
    // isMountPoint() is what tells the two apart. Since /mnt (and /mnt/user within it) aren't
    // mount points themselves, anything unmounted here is really just sitting on the boot disk's
    // own filesystem - confirmed live via `stat -f`, same device as `/`.
    if (absPath === root || absPath === config.shareMountRoot) {
      await Promise.all(
        entries.map(async (entry) => {
          if (entry.type !== 'directory') return;
          const entryAbsPath = path.join(absPath, entry.name);
          if (!(await isMountPoint(entryAbsPath).catch(() => false))) {
            entry.locationType = 'boot';
            return;
          }
          if (absPath === config.shareMountRoot) entry.locationType = 'pool';
          else if (entryAbsPath === config.cacheMountPoint) entry.locationType = 'cache';
          else if (/^disk\d+$/.test(entry.name)) entry.locationType = 'disk';
        }),
      );
    } else if (path.dirname(absPath) === root && /^disk\d+$/.test(path.basename(absPath))) {
      // Inside a raw array disk (e.g. /mnt/disk1) - each pool's real data actually lives here, one
      // per-disk branch directory per pool, merged together (with every other disk's own copy of
      // the same name) into the unified view at shareMountRoot. Not a mount point itself (that's
      // only true one level up, at /mnt/diskN), so the only way to tell "this is a pool's branch"
      // from "this is just some other directory on the disk" (e.g. Docker/LXC storage relocated
      // here) is whether the name matches a real configured share.
      const shareNames = new Set(await this.shares.getShareNames());
      for (const entry of entries) {
        if (entry.type === 'directory' && shareNames.has(entry.name)) entry.locationType = 'pool';
      }
    }

    // Inside a pool's data, mergerfs can blend more than one physical disk into this one
    // directory listing - annotate each entry with which disk(s) it's really on. This is also how
    // BrowsePage.tsx spots a file mistakenly living on more than one branch at once (e.g. written
    // directly to two disks outside mergerfs, over SSH) - see its own isFileConflict(). Reachable
    // two ways: the merged view at shareMountRoot, or browsing a single disk's own branch of the
    // same pool directly (/mnt/diskN/<pool>/...) - locateShareEntries() itself doesn't care which
    // branch you're looking at, it always scans every one. Left undefined everywhere else (e.g.
    // /mnt root, or a raw disk's non-pool content like relocated Docker storage) since the
    // question doesn't apply there - splitShareRelDir() returns null for those paths, or
    // locateShareEntries() returns null when the resulting name isn't a real configured share.
    const diskPrefix = diskBranchPrefix(root, absPath);
    const shareRelDir = splitShareRelDir(`${config.shareMountRoot}/`, absPath) ?? (diskPrefix ? splitShareRelDir(diskPrefix, absPath) : null);
    if (shareRelDir) {
      const locations = await this.shares.locateShareEntries(shareRelDir.shareName, shareRelDir.relDir);
      if (locations) {
        for (const entry of entries) entry.locations = locations[entry.name] ?? [];
      }
    }

    return { root, path: absPath, entries };
  }

  /** Recursive directory size, computed on demand - not part of list() since a full `du` on every
   *  directory in a listing would make browsing large shares painfully slow. Same technique as
   *  fileMove/service.ts's private duBytes(). */
  async size(requestPath: string): Promise<number> {
    const { absPath } = await resolveExisting(requestPath);
    const st = await stat(absPath);
    if (!st.isDirectory()) return st.size;
    const { stdout } = await execFileAsync('du', ['-sb', absPath], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    return Number(stdout.split('\t')[0]) || 0;
  }

  async resolveDownload(requestPath: string): Promise<{ absPath: string; name: string }> {
    const { absPath } = await resolveExisting(requestPath);
    const st = await stat(absPath);
    if (!st.isFile()) throw new HttpError(400, 'Only files can be downloaded.');
    return { absPath, name: path.basename(absPath) };
  }

  async mkdir(parentPath: string, name: string): Promise<BrowseCommandResult> {
    const { absPath } = await resolveForCreate(parentPath, name);

    const exists = await stat(absPath).then(() => true).catch(() => false);
    if (exists) throw new HttpError(409, `"${name}" already exists.`);

    await mkdir(absPath);
    await chownArrayOwner(absPath);
    return { ok: true, message: `Created folder "${name}"` };
  }

  async rename(requestPath: string, newName: string): Promise<BrowseCommandResult> {
    const { root, absPath } = await resolveExisting(requestPath);
    if (absPath === root) throw new HttpError(400, 'Cannot rename the browse root.');
    if (await isMountPoint(absPath)) {
      throw new HttpError(400, `"${path.basename(absPath)}" is a mount point (a share, or an array disk) - rename it from the Sharing page instead.`);
    }

    const parentPath = path.dirname(absPath);
    const { absPath: destAbs } = await resolveForCreate(parentPath, newName);
    if (destAbs === absPath) return { ok: true, message: `Renamed to "${newName}"` };

    const destExists = await stat(destAbs).then(() => true).catch(() => false);
    if (destExists) throw new HttpError(409, `"${newName}" already exists.`);

    await rename(absPath, destAbs);
    return { ok: true, message: `Renamed to "${newName}"` };
  }

  async move(requestPath: string, destParentPath: string): Promise<BrowseCommandResult> {
    const { root, absPath } = await resolveExisting(requestPath);
    if (absPath === root) throw new HttpError(400, 'Cannot move the browse root.');
    if (await isMountPoint(absPath)) {
      throw new HttpError(400, `"${path.basename(absPath)}" is a mount point (a share, or an array disk) - it can't be moved.`);
    }

    const name = path.basename(absPath);
    const { absPath: destAbs } = await resolveForCreate(destParentPath, name);
    const destParentStat = await stat(path.dirname(destAbs));
    if (!destParentStat.isDirectory()) throw new HttpError(400, 'Destination is not a directory.');
    if (destAbs === absPath) return { ok: true, message: `Moved "${name}"` };

    const destExists = await stat(destAbs).then(() => true).catch(() => false);
    if (destExists) throw new HttpError(409, `"${name}" already exists at the destination.`);

    try {
      await rename(absPath, destAbs);
    } catch {
      // Cross-device rename normally fails with EXDEV, but FUSE-backed mounts like mergerfs
      // return ENOTCONN instead when source and destination land on different physical
      // branches - same reason saveUpload() below falls back to copy+remove. cp's recursive
      // option handles both files and directories in one call.
      await cp(absPath, destAbs, { recursive: true });
      await chownArrayOwner(destAbs, true);
      await rm(absPath, { recursive: true });
    }
    return { ok: true, message: `Moved "${name}"` };
  }

  async copy(requestPath: string, destParentPath: string): Promise<BrowseCommandResult> {
    const { root, absPath } = await resolveExisting(requestPath);
    if (absPath === root) throw new HttpError(400, 'Cannot copy the browse root.');

    const name = path.basename(absPath);
    const { absPath: destAbs } = await resolveForCreate(destParentPath, name);
    const destParentStat = await stat(path.dirname(destAbs));
    if (!destParentStat.isDirectory()) throw new HttpError(400, 'Destination is not a directory.');
    if (destAbs === absPath) throw new HttpError(400, `Source and destination are the same.`);

    const destExists = await stat(destAbs).then(() => true).catch(() => false);
    if (destExists) throw new HttpError(409, `"${name}" already exists at the destination.`);

    await cp(absPath, destAbs, { recursive: true });
    await chownArrayOwner(destAbs, true);
    return { ok: true, message: `Copied "${name}"` };
  }

  async remove(requestPath: string): Promise<BrowseCommandResult> {
    const { root, absPath } = await resolveExisting(requestPath);
    if (absPath === root) throw new HttpError(400, 'Cannot delete the browse root.');

    // A share's own mount point can't be rmdir'd directly (EBUSY - it's
    // active). If that's what this is, delete the share properly instead:
    // unmount it and wipe its real data from every backing disk.
    const removedShare = await this.shares.removeMountPointWithData(absPath);
    if (removedShare) {
      return { ok: true, message: `Deleted share "${removedShare}" and its data` };
    }

    if (await isMountPoint(absPath)) {
      throw new HttpError(400, `"${path.basename(absPath)}" is a mount point (e.g. an array disk) - it can't be deleted from here.`);
    }
    await rm(absPath, { recursive: true });
    return { ok: true, message: `Deleted "${path.basename(absPath)}"` };
  }

  /** `tempPath` is a file multer already wrote to scratch disk; this validates the
   * destination and moves it into place, cleaning up the temp file either way. */
  async saveUpload(destParentPath: string, originalName: string, tempPath: string): Promise<BrowseCommandResult> {
    try {
      const safeName = path.basename(originalName);
      const { absPath } = await resolveForCreate(destParentPath, safeName);

      const exists = await stat(absPath).then(() => true).catch(() => false);
      if (exists) throw new HttpError(409, `"${safeName}" already exists.`);

      try {
        await rename(tempPath, absPath);
      } catch {
        // Cross-device rename normally fails with EXDEV, but FUSE-backed mounts like
        // mergerfs return ENOTCONN instead when the source (our OS temp dir) lives
        // outside the union - so fall back to copy+unlink on any rename failure here;
        // a genuine destination problem (permissions, no space) will surface from copyFile.
        await copyFile(tempPath, absPath);
        await unlink(tempPath).catch(() => {});
      }
      await chownArrayOwner(absPath);
      return { ok: true, message: `Uploaded "${safeName}"` };
    } catch (err) {
      await unlink(tempPath).catch(() => {});
      throw err;
    }
  }
}
