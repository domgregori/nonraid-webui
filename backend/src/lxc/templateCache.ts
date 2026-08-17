import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { runSudoMaybe } from '../system/procUtil.js';

const execFileAsync = promisify(execFile);
const CACHE_DIR = '/var/cache/lxc/download';

export interface PruneTemplateCacheResult {
  spaceReclaimedBytes: number;
}

async function dirSizeBytes(dirPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('du', ['-sb', dirPath]);
    return Number(stdout.split(/\s+/)[0]) || 0;
  } catch {
    return 0; // doesn't exist yet - nothing cached
  }
}

/**
 * Clears lxc-create --template download's local cache
 * (/var/cache/lxc/download/<distro>/<release>/<arch>) - unlike Docker images, this is never "in
 * use" by a live container: lxc-create extracts a full, independent rootfs copy into the
 * container's own directory at creation time, so the cache is purely a speed-up for future creates
 * of the same distro/release/arch, not something any existing container depends on. Safe to clear
 * at any time; worst case is a slower re-download next time that combination is created again.
 */
export async function pruneTemplateCache(): Promise<PruneTemplateCacheResult> {
  const spaceReclaimedBytes = await dirSizeBytes(CACHE_DIR);
  await runSudoMaybe('rm', ['-rf', CACHE_DIR]);
  await runSudoMaybe('mkdir', ['-p', CACHE_DIR]);
  return { spaceReclaimedBytes };
}
