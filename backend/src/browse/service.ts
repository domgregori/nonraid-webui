import { copyFile, mkdir, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '../httpError.js';
import type { ShareStore } from '../shares/store.js';
import { relativeTo, resolveExisting, resolveForCreate } from './paths.js';
import type { BrowseCommandResult, BrowseEntry, BrowseListing } from './types.js';

export class BrowseService {
  constructor(private shareStore: ShareStore) {}

  private async assertShareExists(shareName: string): Promise<void> {
    if (!(await this.shareStore.get(shareName))) {
      throw new HttpError(404, `Share "${shareName}" not found.`);
    }
  }

  async list(shareName: string, relPath: string): Promise<BrowseListing> {
    await this.assertShareExists(shareName);
    const { root, absPath } = await resolveExisting(shareName, relPath);
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

    return { share: shareName, path: relativeTo(root, absPath), entries };
  }

  async resolveDownload(shareName: string, relPath: string): Promise<{ absPath: string; name: string }> {
    await this.assertShareExists(shareName);
    const { absPath } = await resolveExisting(shareName, relPath);
    const st = await stat(absPath);
    if (!st.isFile()) throw new HttpError(400, 'Only files can be downloaded.');
    return { absPath, name: path.basename(absPath) };
  }

  async mkdir(shareName: string, parentRelPath: string, name: string): Promise<BrowseCommandResult> {
    await this.assertShareExists(shareName);
    const { absPath } = await resolveForCreate(shareName, parentRelPath, name);

    const exists = await stat(absPath).then(() => true).catch(() => false);
    if (exists) throw new HttpError(409, `"${name}" already exists.`);

    await mkdir(absPath);
    return { ok: true, message: `Created folder "${name}"` };
  }

  async rename(shareName: string, relPath: string, newName: string): Promise<BrowseCommandResult> {
    await this.assertShareExists(shareName);
    const { root, absPath } = await resolveExisting(shareName, relPath);
    if (absPath === root) throw new HttpError(400, 'Cannot rename a share root.');

    const parentRel = relativeTo(root, path.dirname(absPath));
    const { absPath: destAbs } = await resolveForCreate(shareName, parentRel, newName);
    if (destAbs === absPath) return { ok: true, message: `Renamed to "${newName}"` };

    const destExists = await stat(destAbs).then(() => true).catch(() => false);
    if (destExists) throw new HttpError(409, `"${newName}" already exists.`);

    await rename(absPath, destAbs);
    return { ok: true, message: `Renamed to "${newName}"` };
  }

  async move(shareName: string, relPath: string, destParentRelPath: string): Promise<BrowseCommandResult> {
    await this.assertShareExists(shareName);
    const { root, absPath } = await resolveExisting(shareName, relPath);
    if (absPath === root) throw new HttpError(400, 'Cannot move a share root.');

    const name = path.basename(absPath);
    const { absPath: destAbs } = await resolveForCreate(shareName, destParentRelPath, name);
    const destParentStat = await stat(path.dirname(destAbs));
    if (!destParentStat.isDirectory()) throw new HttpError(400, 'Destination is not a directory.');
    if (destAbs === absPath) return { ok: true, message: `Moved "${name}"` };

    const destExists = await stat(destAbs).then(() => true).catch(() => false);
    if (destExists) throw new HttpError(409, `"${name}" already exists at the destination.`);

    await rename(absPath, destAbs);
    return { ok: true, message: `Moved "${name}"` };
  }

  async remove(shareName: string, relPath: string): Promise<BrowseCommandResult> {
    await this.assertShareExists(shareName);
    const { root, absPath } = await resolveExisting(shareName, relPath);
    if (absPath === root) throw new HttpError(400, 'Cannot delete a share root.');
    await rm(absPath, { recursive: true });
    return { ok: true, message: `Deleted "${path.basename(absPath)}"` };
  }

  /** `tempPath` is a file multer already wrote to scratch disk; this validates the
   * destination and moves it into place, cleaning up the temp file either way. */
  async saveUpload(shareName: string, destParentRelPath: string, originalName: string, tempPath: string): Promise<BrowseCommandResult> {
    try {
      await this.assertShareExists(shareName);
      const safeName = path.basename(originalName);
      const { absPath } = await resolveForCreate(shareName, destParentRelPath, safeName);

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
