import zlib from 'node:zlib';
import AdmZip from 'adm-zip';
import * as tar from 'tar';
import { isRelevantConfigPath, type ImportedFile } from './types.js';

/**
 * Extracts every file this importer actually cares about from an uploaded archive - see
 * isRelevantConfigPath()'s doc comment for why everything else (a real Unraid config/ directory's
 * plugin package cache especially) gets skipped rather than buffered. Detected by filename, not
 * content sniffing: an admin picking the wrong file gets a clear "couldn't read this as an
 * archive" error from whichever library actually chokes on it, rather than this silently guessing.
 */
export async function extractArchive(filename: string, buf: Buffer): Promise<ImportedFile[]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.zip')) return extractZip(buf);
  if (lower.endsWith('.tgz') || lower.endsWith('.tar.gz')) return extractTar(zlib.gunzipSync(buf));
  if (lower.endsWith('.tar')) return extractTar(buf);
  throw new Error(`Unrecognized archive type for "${filename}" - expected .tar, .tar.gz, .tgz, or .zip.`);
}

function extractZip(buf: Buffer): ImportedFile[] {
  const zip = new AdmZip(buf);
  const files: ImportedFile[] = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !isRelevantConfigPath(entry.entryName)) continue;
    files.push({ relativePath: entry.entryName, content: entry.getData() });
  }
  return files;
}

function extractTar(buf: Buffer): Promise<ImportedFile[]> {
  const files: ImportedFile[] = [];
  return new Promise((resolve, reject) => {
    const parser = new tar.Parser({
      onReadEntry: (entry) => {
        if (entry.type !== 'File' || !isRelevantConfigPath(entry.path)) {
          entry.resume();
          return;
        }
        const chunks: Buffer[] = [];
        entry.on('data', (chunk: Buffer) => chunks.push(chunk));
        entry.on('end', () => {
          files.push({ relativePath: entry.path, content: Buffer.concat(chunks) });
        });
      },
    });
    parser.on('error', reject);
    parser.on('end', () => resolve(files));
    parser.end(buf);
  });
}
