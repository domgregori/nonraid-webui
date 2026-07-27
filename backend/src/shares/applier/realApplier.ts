import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { config } from '../../config.js';
import { HttpError } from '../../httpError.js';
import type { AllocationMethod, Share, ShareCommandResult, ShareStats } from '../types.js';
import type { ApplyContext, ShareApplier } from './client.js';

const execFileAsync = promisify(execFile);

const MANAGED_BEGIN = '# === nonraid-webui:managed-shares:begin ===';
const MANAGED_END = '# === nonraid-webui:managed-shares:end ===';

function mergerfsPolicy(method: AllocationMethod): string {
  switch (method) {
    case 'most-free':
      return 'mfs'; // most free space
    case 'fill-up':
      return 'ff'; // first branch (in order) with room — fills one disk before moving on
    case 'high-water':
      // No exact mergerfs equivalent to Unraid's High-Water. `msp` (most shared path,
      // preferring the branch with the most free space among those already containing
      // the path) is the closest approximation, not a faithful reproduction.
      return 'msp';
    case 'single-disk':
      return 'ff'; // irrelevant — single-disk shares are bind-mounted, not pooled
  }
}

function userMountPath(name: string): string {
  return `${config.shareMountRoot}/${name}`;
}

async function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const useSudo = config.sharesUseSudo;
  try {
    return await execFileAsync(useSudo ? 'sudo' : bin, useSudo ? [bin, ...args] : args, {
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    throw new Error(e.stderr?.trim() || e.stdout?.trim() || e.message);
  }
}

async function isMounted(mountPoint: string): Promise<boolean> {
  try {
    await execFileAsync('mountpoint', ['-q', mountPoint]);
    return true;
  } catch {
    return false;
  }
}

async function replaceManagedBlock(filePath: string, replacementLines: string[]): Promise<void> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    content = `${MANAGED_BEGIN}\n${MANAGED_END}\n`;
  }

  const replacement = [MANAGED_BEGIN, ...replacementLines, MANAGED_END].join('\n');
  const beginIdx = content.indexOf(MANAGED_BEGIN);
  const endIdx = content.indexOf(MANAGED_END);

  const next =
    beginIdx === -1 || endIdx === -1
      ? `${content.trimEnd()}\n\n${replacement}\n`
      : content.slice(0, beginIdx) + replacement + content.slice(endIdx + MANAGED_END.length);

  // best-effort backup before every rewrite — never touch anything outside the markers either way
  await writeFile(`${filePath}.bak`, content, 'utf8').catch(() => {});
  await writeFile(filePath, next, 'utf8');
}

/**
 * Shells out to mergerfs/mount/Samba/NFS tooling. Only ever rewrites the clearly
 * delimited managed block in smb.conf / /etc/exports — never the rest of the file —
 * so it can't clobber anything a real user hand-configured there.
 */
export class RealShareApplier implements ShareApplier {
  readonly mode = 'real' as const;

  private branchPaths(share: Share, ctx: ApplyContext): string[] {
    return share.disks
      .map((slot) => ctx.diskMountpoints[slot])
      .filter((mp): mp is string => Boolean(mp))
      .map((mp) => `${mp}/${share.name}`);
  }

  async mountShare(share: Share, ctx: ApplyContext): Promise<ShareCommandResult> {
    const branches = this.branchPaths(share, ctx);
    if (branches.length === 0) {
      throw new HttpError(409, `No mounted disks available for share "${share.name}" — its assigned disks are all offline.`);
    }

    for (const branch of branches) {
      await mkdir(branch, { recursive: true });
    }

    const mountPoint = userMountPath(share.name);
    await mkdir(mountPoint, { recursive: true });

    // idempotent: branch list or policy may have changed since last apply
    if (await isMounted(mountPoint)) {
      await run('umount', [mountPoint]);
    }

    if (branches.length === 1) {
      // no pooling needed for a single branch
      await run('mount', ['--bind', branches[0]!, mountPoint]);
    } else {
      const policy = mergerfsPolicy(share.allocationMethod);
      await run('mergerfs', ['-o', `category.create=${policy},use_ino`, branches.join(':'), mountPoint]);
    }

    return { ok: true, message: `Share "${share.name}" mounted at ${mountPoint} (${branches.length} disk${branches.length === 1 ? '' : 's'})` };
  }

  async unmountShare(name: string): Promise<ShareCommandResult> {
    const mountPoint = userMountPath(name);
    if (await isMounted(mountPoint)) {
      await run('umount', [mountPoint]);
    }
    return { ok: true, message: `Share "${name}" unmounted` };
  }

  async getStats(share: Share): Promise<ShareStats> {
    try {
      const { stdout } = await execFileAsync('df', ['-k', '--output=used,size', userMountPath(share.name)]);
      const lastLine = stdout.trim().split('\n').at(-1) ?? '';
      const parts = lastLine.trim().split(/\s+/).map(Number);
      const usedKb = parts[0];
      const sizeKb = parts[1];
      if (!Number.isFinite(usedKb) || !Number.isFinite(sizeKb)) return { usedBytes: null, totalBytes: null };
      return { usedBytes: usedKb! * 1024, totalBytes: sizeKb! * 1024 };
    } catch {
      return { usedBytes: null, totalBytes: null };
    }
  }

  async syncExports(allShares: Share[]): Promise<ShareCommandResult> {
    await this.writeSmbBlock(allShares);
    await this.writeExportsBlock(allShares);
    return { ok: true, message: 'Samba/NFS config synced' };
  }

  private async writeSmbBlock(shares: Share[]): Promise<void> {
    const lines: string[] = [];
    for (const s of shares) {
      if (!s.protocols.includes('smb')) continue;
      lines.push(`[${s.name}]`);
      lines.push(`   path = ${userMountPath(s.name)}`);
      lines.push(`   browseable = yes`);
      lines.push(`   writable = yes`);
      lines.push(`   guest ok = ${s.smb?.public !== false ? 'yes' : 'no'}`);
    }
    await replaceManagedBlock(config.smbConfPath, lines);

    try {
      await run('smbcontrol', ['smbd', 'reload-config']);
    } catch {
      // smbd may not have been running yet (fresh environment) — start it instead
      await run('smbd', ['-D']).catch(() => {
        throw new Error('Failed to reload or start smbd after updating smb.conf');
      });
    }
  }

  private async writeExportsBlock(shares: Share[]): Promise<void> {
    const lines: string[] = [];
    for (const s of shares) {
      if (!s.protocols.includes('nfs')) continue;
      const hosts = s.nfs?.allowedHosts?.length ? s.nfs.allowedHosts : ['*'];
      const opts = s.nfs?.readOnly ? 'ro,sync,no_subtree_check' : 'rw,sync,no_subtree_check';
      for (const host of hosts) {
        lines.push(`${userMountPath(s.name)} ${host}(${opts})`);
      }
    }
    await replaceManagedBlock(config.exportsPath, lines);
    // best-effort — NFS kernel server may not be available in every environment (see backend/testing/README.md)
    await run('exportfs', ['-ra']).catch(() => {});
  }
}
