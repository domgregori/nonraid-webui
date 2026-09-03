import { execFile } from 'node:child_process';
import { copyFile, cp, mkdir, open, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import * as tar from 'tar';
import type { Pack } from 'tar';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import type { ShareService } from '../shares/index.js';
import { assertValidSegmentName, isMountPoint, resolveExisting, resolveForCreate } from './paths.js';
import type { BrowseCommandResult, BrowseEntry, BrowseFileContent, BrowseListing } from './types.js';

// Generous for text/config files, protects against loading something huge into a browser editor.
const MAX_EDIT_BYTES = 2 * 1024 * 1024;

const execFileAsync = promisify(execFile);

/** Fires as a recursive copy/move progresses - `filesDone` is a running count, not a fraction of
 *  a known total (getting a total would mean walking the whole tree twice - once to count, once
 *  to actually copy - which costs real time on a big tree for a number that's only cosmetic). */
export type FileProgressCallback = (currentFile: string, filesDone: number) => void;

// `cp()`'s own `filter` option runs once per file/directory it visits during a recursive
// copy - not there to filter anything here, but the only hook Node's cp() exposes for
// observing progress on an operation it otherwise runs as one opaque call. A large tree
// (confirmed live elsewhere in this app: real shares with 150,000+ entries) would mean
// this many ndjson events too if every single one produced a tick, so only every 20th
// file actually sends one - the caller still needs the correctness of the same cp() call
// on every file, this only limits how often that gets reported.
const PROGRESS_EVERY_N_FILES = 20;
function throttledFilter(onFile: FileProgressCallback | undefined): ((src: string) => boolean) | undefined {
  if (!onFile) return undefined;
  let filesDone = 0;
  return (src: string) => {
    filesDone++;
    if (filesDone % PROGRESS_EVERY_N_FILES === 0) onFile(path.basename(src), filesDone);
    return true;
  };
}

/** Same simple heuristic git/`file` use - a NUL byte in the first 8KB means binary, not text.
 *  Reads only that first chunk via a file handle rather than the whole file, so it's cheap enough
 *  to run per-entry while listing a directory (unlike readFile(), which needs the full content
 *  anyway and so checks the buffer it already has to read). */
async function looksBinary(absPath: string): Promise<boolean> {
  const fh = await open(absPath, 'r');
  try {
    const buf = Buffer.alloc(8000);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } finally {
    await fh.close();
  }
}

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
        const entryAbsPath = path.join(absPath, d.name);
        const entryStat = await stat(entryAbsPath).catch(() => null);
        const type = d.isSymbolicLink() ? 'symlink' : d.isDirectory() ? 'directory' : 'file';
        // Only sniff files small enough to actually edit - skips the read entirely for huge files
        // (videos, disk images, archives), which the size cap alone already disqualifies.
        const editable =
          type === 'file' && entryStat !== null && entryStat.size <= MAX_EDIT_BYTES
            ? entryStat.size === 0 || !(await looksBinary(entryAbsPath).catch(() => true))
            : undefined;
        return {
          name: d.name,
          type,
          size: entryStat?.size ?? 0,
          modifiedAt: (entryStat?.mtime ?? new Date(0)).toISOString(),
          ...(editable !== undefined && { editable }),
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

  /**
   * Resolves a folder (or several selected entries within one folder - the Browse page's
   * selection is always siblings, never a cross-directory pick) into what streamArchive() needs:
   * a cwd and a list of plain entry names underneath it. Archiving relative to that cwd (rather
   * than absolute paths) is what keeps each archive entry's own path short and portable instead of
   * embedding "/mnt/user/whatever/" into every file's path inside the archive.
   *
   * Each name is validated as a single path segment (assertValidSegmentName - same check
   * resolveForCreate uses) before being joined onto the already-resolved, already-inside-the-
   * browse-root parent directory, so there's no way for a crafted name to escape it via `..` or
   * an absolute path slipped into the array.
   */
  async resolveArchiveTargets(dirPath: string, names: unknown[]): Promise<{ cwd: string; entries: string[]; archiveName: string }> {
    if (!Array.isArray(names) || names.length === 0) throw new HttpError(400, 'At least one item is required.');
    for (const name of names) assertValidSegmentName(name);
    const validNames = names as string[];

    const { absPath: dirAbs } = await resolveExisting(dirPath);
    const dirStat = await stat(dirAbs);
    if (!dirStat.isDirectory()) throw new HttpError(400, 'Not a directory.');

    for (const name of validNames) {
      try {
        await stat(path.join(dirAbs, name));
      } catch {
        throw new HttpError(404, `"${name}" doesn't exist.`);
      }
    }

    const archiveName = validNames.length === 1 ? `${validNames[0]}.tar.gz` : `${validNames.length}-items.tar.gz`;
    return { cwd: dirAbs, entries: validNames, archiveName };
  }

  /**
   * Streams a .tar.gz of `entries` (relative to `cwd`, see resolveArchiveTargets) directly to the
   * response rather than buffering an archive in memory first - the `tar` package (already a
   * dependency, for the Unraid-import side's own archive reading) returns a live Pack stream when
   * called with neither `file` nor `sync` set, so a multi-gigabyte folder's compressed bytes never
   * have to sit in the Node process at once.
   *
   * .tar.gz over .zip: this app has no zip-writing library (adm-zip, also already a dependency,
   * only reads for the Unraid-import side and is fully in-memory besides), while `tar` is already
   * pulled in and streams natively. Every mainstream OS can open a .tar.gz today (Windows 11's own
   * Explorer included).
   */
  streamArchive(cwd: string, entries: string[]): Pack {
    // tar.create()'s overloaded type signature covers the file/sync/callback variants too, so TS
    // can't narrow it down on its own - passing neither `file` nor `sync` here always returns a
    // live Pack stream at runtime (this package's own documented behavior), never one of the other
    // union members, hence the cast.
    return tar.create({ gzip: true, cwd, portable: true }, entries) as Pack;
  }

  /** Loads a file's content for the Browse page's text editor - only text, and only up to
   *  MAX_EDIT_BYTES, unlike download which has no such limits (a browser editor loading the whole
   *  file into memory is a very different cost than streaming bytes to a download). */
  async readFile(requestPath: string): Promise<BrowseFileContent> {
    const { absPath } = await resolveExisting(requestPath);
    const st = await stat(absPath);
    if (!st.isFile()) throw new HttpError(400, 'Not a file.');
    if (st.size > MAX_EDIT_BYTES) {
      throw new HttpError(413, `File is too large to edit (${(st.size / 1024 / 1024).toFixed(1)}MB) - download it instead.`);
    }
    const buf = await readFile(absPath);
    // Same simple heuristic git/`file` use - a NUL byte in the first 8KB means binary, not text.
    if (buf.subarray(0, 8000).includes(0)) throw new HttpError(400, 'File appears to be binary, not text.');
    return { content: buf.toString('utf8') };
  }

  async writeFile(requestPath: string, content: string): Promise<BrowseCommandResult> {
    const { absPath } = await resolveExisting(requestPath);
    const st = await stat(absPath);
    if (!st.isFile()) throw new HttpError(400, 'Not a file.');
    await writeFile(absPath, content, 'utf8');
    await chownArrayOwner(absPath);
    return { ok: true, message: `Saved "${path.basename(absPath)}"` };
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

  async move(requestPath: string, destParentPath: string, onFile?: FileProgressCallback): Promise<BrowseCommandResult> {
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
      await cp(absPath, destAbs, { recursive: true, filter: throttledFilter(onFile) });
      await chownArrayOwner(destAbs, true);
      await rm(absPath, { recursive: true });
    }
    return { ok: true, message: `Moved "${name}"` };
  }

  async copy(requestPath: string, destParentPath: string, onFile?: FileProgressCallback): Promise<BrowseCommandResult> {
    const { root, absPath } = await resolveExisting(requestPath);
    if (absPath === root) throw new HttpError(400, 'Cannot copy the browse root.');

    const name = path.basename(absPath);
    const { absPath: destAbs } = await resolveForCreate(destParentPath, name);
    const destParentStat = await stat(path.dirname(destAbs));
    if (!destParentStat.isDirectory()) throw new HttpError(400, 'Destination is not a directory.');
    if (destAbs === absPath) throw new HttpError(400, `Source and destination are the same.`);

    const destExists = await stat(destAbs).then(() => true).catch(() => false);
    if (destExists) throw new HttpError(409, `"${name}" already exists at the destination.`);

    await cp(absPath, destAbs, { recursive: true, filter: throttledFilter(onFile) });
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
