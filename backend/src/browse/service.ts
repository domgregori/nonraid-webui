import { copyFile, mkdir, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '../httpError.js';
import type { ShareService } from '../shares/index.js';
import { isMountPoint, resolveExisting, resolveForCreate } from './paths.js';
import type { BrowseCommandResult, BrowseEntry, BrowseListing } from './types.js';

/** Browses the whole /mnt tree (config.browseRoot), not a single share — see
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

    return { root, path: absPath, entries };
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
    return { ok: true, message: `Created folder "${name}"` };
  }

  async rename(requestPath: string, newName: string): Promise<BrowseCommandResult> {
    const { root, absPath } = await resolveExisting(requestPath);
    if (absPath === root) throw new HttpError(400, 'Cannot rename the browse root.');
    if (await isMountPoint(absPath)) {
      throw new HttpError(400, `"${path.basename(absPath)}" is a mount point (a share, or an array disk) — rename it from the Sharing page instead.`);
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
      throw new HttpError(400, `"${path.basename(absPath)}" is a mount point (a share, or an array disk) — it can't be moved.`);
    }

    const name = path.basename(absPath);
    const { absPath: destAbs } = await resolveForCreate(destParentPath, name);
    const destParentStat = await stat(path.dirname(destAbs));
    if (!destParentStat.isDirectory()) throw new HttpError(400, 'Destination is not a directory.');
    if (destAbs === absPath) return { ok: true, message: `Moved "${name}"` };

    const destExists = await stat(destAbs).then(() => true).catch(() => false);
    if (destExists) throw new HttpError(409, `"${name}" already exists at the destination.`);

    await rename(absPath, destAbs);
    return { ok: true, message: `Moved "${name}"` };
  }

  async remove(requestPath: string): Promise<BrowseCommandResult> {
    const { root, absPath } = await resolveExisting(requestPath);
    if (absPath === root) throw new HttpError(400, 'Cannot delete the browse root.');

    // A share's own mount point can't be rmdir'd directly (EBUSY — it's
    // active). If that's what this is, delete the share properly instead:
    // unmount it and wipe its real data from every backing disk.
    const removedShare = await this.shares.removeMountPointWithData(absPath);
    if (removedShare) {
      return { ok: true, message: `Deleted share "${removedShare}" and its data` };
    }

    if (await isMountPoint(absPath)) {
      throw new HttpError(400, `"${path.basename(absPath)}" is a mount point (e.g. an array disk) — it can't be deleted from here.`);
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
        // outside the union — so fall back to copy+unlink on any rename failure here;
        // a genuine destination problem (permissions, no space) will surface from copyFile.
        await copyFile(tempPath, absPath);
        await unlink(tempPath).catch(() => {});
      }
      return { ok: true, message: `Uploaded "${safeName}"` };
    } catch (err) {
      await unlink(tempPath).catch(() => {});
      throw err;
    }
  }
}
