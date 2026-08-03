import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { config } from '../../config.js';
import { HttpError } from '../../httpError.js';
import type { AllocationMethod, Share, ShareAccess, ShareCommandResult, ShareStats } from '../types.js';
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
      // No exact mergerfs equivalent to Unraid's High-Water. `mspmfs` (most shared path,
      // tie-broken by most free space among branches that already contain the path) is
      // the closest approximation, not a faithful reproduction. Bare `msp` is NOT a valid
      // policy name on its own — it's always paired with a tiebreak suffix (mspmfs/msplfs/
      // msppfrd/msplus). mergerfs 2.33.5 silently accepted the invalid bare `msp` and only
      // segfaulted later on an actual write; 2.42.0 correctly rejects it up front.
      return 'mspmfs';
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
      // mergerfs excludes any branch below `minfreespace` from create-policy consideration —
      // its own default (4G) is a sane safety margin on real multi-TB disks, but it silently
      // makes every branch ineligible (ENOSPC on every write) on small disks. ctx.minFreeSpaceMb
      // comes from Settings (default 100M, matching this repo's small test disks) rather than
      // being hardcoded, so real deployments can raise it back toward mergerfs's own default.
      await run('mergerfs', ['-o', `category.create=${policy},use_ino,minfreespace=${ctx.minFreeSpaceMb}M`, branches.join(':'), mountPoint]);
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

  async syncExports(allShares: Share[], accessByShare: Record<string, ShareAccess>): Promise<ShareCommandResult> {
    await this.writeSmbBlock(allShares, accessByShare);
    await this.writeExportsBlock(allShares);
    return { ok: true, message: 'Samba/NFS config synced' };
  }

  private async writeSmbBlock(shares: Share[], accessByShare: Record<string, ShareAccess>): Promise<void> {
    const lines: string[] = [];
    for (const s of shares) {
      if (!s.protocols.includes('smb')) continue;
      const access = accessByShare[s.name] ?? { users: {}, groups: {} };

      // Samba principal syntax: users bare, groups prefixed with '@'.
      const named = (perm: 'read-write' | 'read-only' | 'none' | 'hidden') => [
        ...Object.entries(access.users).filter(([, p]) => p === perm).map(([name]) => name),
        ...Object.entries(access.groups).filter(([, p]) => p === perm).map(([name]) => `@${name}`),
      ];
      const writeUsers = named('read-write');
      const readOnlyUsers = named('read-only');
      const deniedUsers = named('none');
      const hiddenUsers = named('hidden');
      const isPublic = s.smb?.public !== false;

      lines.push(`[${s.name}]`);
      lines.push(`   path = ${userMountPath(s.name)}`);
      lines.push(`   browseable = yes`);
      // Share stays writable by default, same as before per-user ACLs existed — this
      // must not silently lock guest/public shares to read-only. `read list` (below)
      // carves out per-user read-only *exceptions* to that default instead.
      lines.push(`   writable = yes`);
      lines.push(`   guest ok = ${isPublic ? 'yes' : 'no'}`);

      const validUsers = [...writeUsers, ...readOnlyUsers];
      // Non-public shares require real accounts, so only they get `valid users` — for
      // public shares that would fight with `guest ok` and defeat the point of "public".
      if (!isPublic && validUsers.length > 0) lines.push(`   valid users = ${validUsers.join(', ')}`);
      if (readOnlyUsers.length > 0) lines.push(`   read list = ${readOnlyUsers.join(', ')}`);

      // `invalid users` denies a named account/group regardless of guest ok, so this still
      // works to carve exceptions out of an otherwise-public share. On a private share with
      // no explicit grants yet, deny everyone via the `*` wildcard instead of falling back
      // to Samba's actual default (any account that can authenticate at all) — a private
      // share with zero grants must mean "nobody has access", not "wide open".
      const invalidUsers = !isPublic && validUsers.length === 0 ? ['*'] : [...deniedUsers, ...hiddenUsers];
      if (invalidUsers.length > 0) lines.push(`   invalid users = ${invalidUsers.join(', ')}`);
      // Samba has no native "denied but still browseable" vs "denied and invisible"
      // distinction *per user* — access based share enum is share-wide only. So
      // 'hidden' is approximated as: turn on ABE for the whole share whenever anyone
      // has 'hidden' set, which also hides it from any 'none' principals as a side
      // effect (an acceptable approximation, not a faithful per-user hide).
      if (hiddenUsers.length > 0) lines.push(`   access based share enum = yes`);
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
    // best-effort — NFS kernel server may not be available in every environment
    await run('exportfs', ['-ra']).catch(() => {});
  }
}
