import { open } from 'node:fs/promises';

// Generous for text/config files, protects against loading something huge into a browser editor.
// Extracted from backend/src/browse/service.ts so share-server's editable-mode text editor enforces
// the identical cap as the admin Browse editor, not a hand-reimplemented copy that could drift.
export const MAX_EDIT_BYTES = 2 * 1024 * 1024;

/** Same simple heuristic git/`file` use - a NUL byte in the first 8KB means binary, not text.
 *  Reads only that first chunk via a file handle rather than the whole file, so it's cheap enough
 *  to run per-entry while listing a directory (unlike readFile(), which needs the full content
 *  anyway and so checks the buffer it already has to read). */
export async function looksBinary(absPath: string): Promise<boolean> {
  const fh = await open(absPath, 'r');
  try {
    const buf = Buffer.alloc(8000);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } finally {
    await fh.close();
  }
}
