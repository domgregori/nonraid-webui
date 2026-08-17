import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
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
      return 'ff'; // first branch (in order) with room - fills one disk before moving on
    case 'high-water':
      // No exact mergerfs equivalent to this app's own High-Water allocation method. `mspmfs` (most shared path,
      // tie-broken by most free space among branches that already contain the path) is
      // the closest approximation, not a faithful reproduction. Bare `msp` is NOT a valid
      // policy name on its own - it's always paired with a tiebreak suffix (mspmfs/msplfs/
      // msppfrd/msplus). mergerfs 2.33.5 silently accepted the invalid bare `msp` and only
      // segfaulted later on an actual write; 2.42.0 correctly rejects it up front.
      return 'mspmfs';
    case 'single-disk':
      return 'ff'; // irrelevant - single-disk shares are bind-mounted, not pooled
    case 'cache-only':
      return 'ff'; // irrelevant - cache-only shares are bind-mounted to the cache branch alone
  }
}

function userMountPath(name: string): string {
  return `${config.shareMountRoot}/${name}`;
}

async function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(bin, args, {
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    throw new Error(e.stderr?.trim() || e.stdout?.trim() || e.message);
  }
}

/**
 * Creates `dirPath` if missing and makes it (and everything created under it afterward - by this
 * app, Samba, NFS, or a Docker container bind-mounting it) owned by config.arrayDataOwner/Group -
 * the classic linuxserver.io nobody:users (99:100) convention most Community-Apps
 * containers already default their own PUID/PGID to. The default ACL (`-d`) is what makes this
 * apply to *new* content going forward too, not just this one directory: POSIX default ACLs are
 * inherited by every file/subdirectory created under it afterward, regardless of which uid
 * actually creates them - so Browse's own mkdir/upload, a Samba write, or a bind-mounted
 * container's write all land with the same access without this app needing to chown after every
 * individual create call.
 */
async function provisionArrayDir(dirPath: string): Promise<void> {
  await run('mkdir', ['-p', dirPath]);
  await run('chown', [`${config.arrayDataOwner}:${config.arrayDataGroup}`, dirPath]);
  // Setgid on every directory in the tree (not just dirPath itself) - Linux propagates it to every
  // new subdirectory created afterward, so group=users is correct forever with no per-call-site
  // code, even for content this backend's own root process creates directly (browse/service.ts,
  // fileMove/service.ts). Only directories, not files - `find -type d` avoids setting the same bit
  // on a regular file, where it means something unrelated (mandatory locking).
  await run('find', [dirPath, '-type', 'd', '-exec', 'chmod', 'g+s', '{}', '+']);
  const acl = `u:${config.arrayDataOwner}:rwx,g:${config.arrayDataGroup}:rwx`;
  await run('setfacl', ['-R', '-m', acl, '-d', '-m', acl, dirPath]);
}

async function isMounted(mountPoint: string): Promise<boolean> {
  try {
    await execFileAsync('mountpoint', ['-q', mountPoint]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Releases knfsd's own hold on `mountPoint` before it gets unmounted. Without this, editing (or
 * removing) any currently NFS-exported share fails with a real `umount: target is busy` -
 * confirmed live: nfsd keeps an exported path pinned in its own export table independent of
 * whether any client is actually connected, and mountShare()/unmountShare() below always run
 * before resyncExports() gets a chance to refresh that table with the new state. Best-effort and
 * safe to call unconditionally: unexporting a path that was never exported (SMB-only shares, or
 * an NFS server not installed at all) is a harmless no-op here, not an error worth surfacing.
 */
async function unexport(mountPoint: string): Promise<void> {
  await run('exportfs', ['-u', mountPoint]).catch(() => {});
}

/**
 * Disconnects every SMB client currently connected to `shareName` before it gets unmounted -
 * unexport() above only releases NFS's own hold, but a connected SMB client leaves a live smbd
 * worker process with its cwd (and any open files) inside the share, which is just as real a VFS
 * reference as an open file descriptor and blocks `umount` exactly the same way. Confirmed live:
 * `umount: /mnt/user/<share>: target is busy` while a client's smbd worker still had the mount
 * point as its cwd, resolved immediately by this call. Best-effort and safe to call
 * unconditionally: closing a share with no active connections (SMB-only-just-enabled, NFS-only
 * shares, or smbd not running at all) is a harmless no-op here, not an error worth surfacing.
 */
async function closeSmbClients(shareName: string): Promise<void> {
  await run('smbcontrol', ['smbd', 'close-share', shareName]).catch(() => {});
}

/**
 * True when `mountPoint` is currently a FUSE mount (mergerfs, in this app's case). knfsd can
 * derive a stable filesystem id from a real block device or bind mount on its own, but not from
 * FUSE - exporting one without an explicit `fsid=` fails outright ("Cannot export ... possibly
 * unsupported filesystem or fsid= required", confirmed live). Reads /proc/mounts directly rather
 * than re-deriving branch count from share config, since what's actually mounted right now (which
 * can differ from the configured disk list if some are currently offline) is what NFS needs to
 * match - same live-state source of truth mountShare() itself uses via its own branches.length.
 */
async function isFuseMount(mountPoint: string): Promise<boolean> {
  try {
    const mounts = await readFile('/proc/mounts', 'utf8');
    const line = mounts.split('\n').find((l) => l.split(' ')[1] === mountPoint);
    return line?.split(' ')[2]?.startsWith('fuse.') ?? false;
  } catch {
    return false;
  }
}

/**
 * Deterministic, non-zero fsid for a FUSE-backed NFS export - stable across re-syncs since it's a
 * pure function of the share name (fsid=0 is reserved for the NFSv4 pseudo-root, so the hash is
 * shifted off it). FNV-1a, more than collision-resistant enough for the small number of shares any
 * one host will realistically have.
 */
function stableFsid(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 0xfffffffe) + 1;
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

  // best-effort backup before every rewrite - never touch anything outside the markers either way
  await writeFile(`${filePath}.bak`, content, 'utf8').catch(() => {});
  await writeFile(filePath, next, 'utf8');
}

/**
 * Shells out to mergerfs/mount/Samba/NFS tooling. Only ever rewrites the clearly
 * delimited managed block in smb.conf / /etc/exports - never the rest of the file -
 * so it can't clobber anything a real user hand-configured there.
 */
export class RealShareApplier implements ShareApplier {

  // single-disk shares are deliberately pinned to one specific array disk (see AllocationMethod's
  // own doc comment) - cache doesn't apply to those, same as they're excluded from
  // ShareInput.allDisks growth. Every other share gets the cache branch listed FIRST when it's
  // available, so mergerfs's `ff` policy (see usesCacheBranch()) writes new files there before
  // ever touching an array disk directly - see the cache pool plan's scope decisions for why this
  // only ever triggers off a confirmed-healthy, fully-mounted ctx.cacheMountPoint (set in
  // ShareService.buildContext(), never a degraded or unmounted mirror).
  private branchPaths(share: Share, ctx: ApplyContext): string[] {
    // Cache-only shares have zero array disks by construction (see validateShareInput) - they
    // mount as a single bind-mount branch on the cache pool alone, never blended with array
    // branches the way usesCacheBranch()'s cache-first-then-array spillover works for other
    // shares. No cache mounted means no branch at all - mountShare() below turns that into a
    // clear "cache pool isn't currently active" error rather than silently mounting nothing.
    if (share.allocationMethod === 'cache-only') {
      return ctx.cacheMountPoint ? [`${ctx.cacheMountPoint}/${share.name}`] : [];
    }

    const arrayBranches = share.disks
      .map((slot) => ctx.diskMountpoints[slot])
      .filter((mp): mp is string => Boolean(mp))
      .map((mp) => `${mp}/${share.name}`);

    if (this.usesCacheBranch(share, ctx)) {
      return [`${ctx.cacheMountPoint}/${share.name}`, ...arrayBranches];
    }
    return arrayBranches;
  }

  private usesCacheBranch(share: Share, ctx: ApplyContext): boolean {
    return ctx.cacheMountPoint !== null && share.allocationMethod !== 'single-disk' && share.allocationMethod !== 'cache-only';
  }

  async mountShare(share: Share, ctx: ApplyContext): Promise<ShareCommandResult> {
    const branches = this.branchPaths(share, ctx);
    if (branches.length === 0) {
      const reason = share.allocationMethod === 'cache-only' ? 'the cache pool is not currently active' : 'its assigned disks are all offline';
      throw new HttpError(409, `No mounted disks available for share "${share.name}" - ${reason}.`);
    }

    for (const branch of branches) {
      await provisionArrayDir(branch);
    }

    const mountPoint = userMountPath(share.name);
    await run('mkdir', ['-p', mountPoint]);

    // idempotent: branch list or policy may have changed since last apply
    if (await isMounted(mountPoint)) {
      await unexport(mountPoint);
      await closeSmbClients(share.name);
      await run('umount', [mountPoint]);
    }

    if (branches.length === 1) {
      // no pooling needed for a single branch
      await run('mount', ['--bind', branches[0]!, mountPoint]);
    } else {
      // Cache-first writes need `ff` (first branch in order with room) regardless of the share's
      // own configured method - mergerfs's category.create is one policy for the whole branch
      // list, so a share can't keep e.g. most-free semantics across the array while also always
      // preferring the cache branch first. Documented plainly in the cache pool plan rather than
      // silently changing behavior.
      const policy = this.usesCacheBranch(share, ctx) ? 'ff' : mergerfsPolicy(share.allocationMethod);
      // mergerfs excludes any branch below `minfreespace` from create-policy consideration -
      // its own default (4G) is a sane safety margin on real multi-TB disks, but it silently
      // makes every branch ineligible (ENOSPC on every write) on small disks. ctx.minFreeSpaceGb
      // comes from Settings (default 100M, matching this repo's small test disks) rather than
      // being hardcoded, so real deployments can raise it back toward mergerfs's own default.
      //
      // `allow_other` is required or FUSE denies every non-root process access to the mount
      // outright, regardless of the underlying directory's own permission bits - confirmed live:
      // smbd (which drops to the connecting user's uid for file access, per Samba's own security
      // model) got ACCESS_DENIED on every multi-disk share for every user, guest or fully
      // authenticated, while single-disk shares (bind-mounted below, no FUSE layer involved) were
      // unaffected. This is the real root cause behind what looked like a guest-only SMB gap.
      // Safe here specifically because this process runs as root - allow_other otherwise needs
      // `user_allow_other` in /etc/fuse.conf, which only matters for a non-root mounting process.
      await run('mergerfs', ['-o', `allow_other,category.create=${policy},use_ino,minfreespace=${ctx.minFreeSpaceGb}G`, branches.join(':'), mountPoint]);
    }

    return { ok: true, message: `Share "${share.name}" mounted at ${mountPoint} (${branches.length} disk${branches.length === 1 ? '' : 's'})` };
  }

  async unmountShare(name: string): Promise<ShareCommandResult> {
    const mountPoint = userMountPath(name);
    if (await isMounted(mountPoint)) {
      await unexport(mountPoint);
      await closeSmbClients(name);
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

  /**
   * NFS is deliberately not counted here - this host has no reliable equivalent to smbstatus for
   * it (showmount/nfs-common isn't installed, and NFSv3's rmtab-based client tracking is widely
   * disabled/unreliable on modern distros anyway), so a fabricated NFS number would be worse than
   * just not showing one. Best-effort: any failure here (smbstatus missing, smbd not running)
   * returns {} rather than throwing - this is a nice-to-have overlay on the share list, not
   * something that should ever break it.
   */
  async getActiveConnectionCounts(): Promise<Record<string, number>> {
    try {
      const { stdout } = await run('smbstatus', ['--json']);
      const data = JSON.parse(stdout) as { tcons?: Record<string, { service?: string }> };
      const counts: Record<string, number> = {};
      for (const tcon of Object.values(data.tcons ?? {})) {
        const service = tcon.service;
        if (!service || service === 'IPC$' || service === 'print$') continue;
        counts[service] = (counts[service] ?? 0) + 1;
      }
      return counts;
    } catch {
      return {};
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
      // Defaults to NOT public: an absent/unspecified smb.public means guest access wasn't
      // explicitly opted into, not that it was implicitly granted.
      const isPublic = s.smb?.public === true;

      lines.push(`[${s.name}]`);
      lines.push(`   path = ${userMountPath(s.name)}`);
      // Purely informational for this app's own UI, but also real, visible value for actual SMB
      // clients: Windows Explorer/Finder show this when browsing the server's shares. smb.conf
      // comment values are single-line, so newlines are stripped rather than escaped.
      if (s.description) lines.push(`   comment = ${s.description.replace(/[\r\n]+/g, ' ')}`);
      lines.push(`   browseable = yes`);
      // Share stays writable by default, same as before per-user ACLs existed - this
      // must not silently lock guest/public shares to read-only. `read list` (below)
      // carves out per-user read-only *exceptions* to that default instead.
      lines.push(`   writable = yes`);
      lines.push(`   guest ok = ${isPublic ? 'yes' : 'no'}`);
      // Share directories are owned config.arrayDataOwner:Group (see mountShare()'s
      // provisionArrayDir()) with a default ACL granting that owner/group rwx - access control is
      // meant to live entirely in this Samba block (valid/invalid/read list above), not in Unix
      // permission bits. Without a `force user`, every non-root grantee (every managed user - none
      // of them are actually root, or arrayDataOwner) hits a real POSIX permission wall on write
      // regardless of what read-write Samba grants them: confirmed live, a user granted read-write
      // could authenticate and list a share but got NT_STATUS_ACCESS_DENIED on any actual write.
      // `force user`/`force group` make smbd perform the real filesystem operation as
      // arrayDataOwner:Group for every connection on this share (matching what Docker CA-app
      // containers using PUID=99/PGID=100 already write as, so SMB and container writes land with
      // the same ownership), so Samba's own ACL logic above is the sole *access* authority, while
      // the filesystem owner/group stays consistent for anything else touching this data.
      lines.push(`   force user = ${config.arrayDataOwner}`);
      lines.push(`   force group = ${config.arrayDataGroup}`);

      const validUsers = [...writeUsers, ...readOnlyUsers];
      // Non-public shares require real accounts, so only they get `valid users` - for
      // public shares that would fight with `guest ok` and defeat the point of "public".
      //
      // A private share with zero grants yet must mean "nobody has access", not Samba's
      // actual default of "any account that can authenticate at all" - but `invalid users`
      // has no wildcard-all token (`*` there only ever matches a literal username "*", which
      // no real account has, so it silently denies nobody - confirmed live: both test
      // accounts could still connect and list a share configured with `invalid users = *`).
      // `valid users` has no such gap: an unmatchable placeholder means the allow-list is
      // non-empty but nothing real is ever in it, so every real account is denied. Uppercase
      // so this app's own username rules (lowercase-only) can never let a real account
      // collide with it.
      if (!isPublic && validUsers.length === 0) {
        lines.push(`   valid users = NONRAID-DENY-ALL-PLACEHOLDER`);
      } else if (!isPublic && validUsers.length > 0) {
        lines.push(`   valid users = ${validUsers.join(', ')}`);
      }
      if (readOnlyUsers.length > 0) lines.push(`   read list = ${readOnlyUsers.join(', ')}`);

      // `invalid users` denies a named account/group regardless of guest ok, so this still
      // works to carve exceptions out of an otherwise-public share.
      const invalidUsers = [...deniedUsers, ...hiddenUsers];
      if (invalidUsers.length > 0) lines.push(`   invalid users = ${invalidUsers.join(', ')}`);
      // Samba has no native "denied but still browseable" vs "denied and invisible"
      // distinction *per user* - access based share enum is share-wide only. So
      // 'hidden' is approximated as: turn on ABE for the whole share whenever anyone
      // has 'hidden' set, which also hides it from any 'none' principals as a side
      // effect (an acceptable approximation, not a faithful per-user hide).
      if (hiddenUsers.length > 0) lines.push(`   access based share enum = yes`);
    }
    await replaceManagedBlock(config.smbConfPath, lines);

    try {
      await run('smbcontrol', ['smbd', 'reload-config']);
    } catch {
      // smbd may not have been running yet (fresh environment) - start it instead
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
      // Multi-disk shares are mergerfs (FUSE) mounts, which knfsd can't export without an
      // explicit fsid - see isFuseMount()'s comment.
      const fsidOpt = (await isFuseMount(userMountPath(s.name))) ? `,fsid=${stableFsid(s.name)}` : '';
      // NFS access control here is host-based only (allowedHosts) - there's no per-user identity
      // at all, unlike SMB. Share directories are owned config.arrayDataOwner:Group (see
      // mountShare()'s provisionArrayDir()), so `all_squash` maps every connecting uid (not just
      // root, which the server's own default root_squash already handles) to `anonuid`/`anongid`
      // set to that same owner/group - matching what SMB's `force user`/`force group` already
      // write as, and what Docker CA-app containers using PUID=99/PGID=100 already write as, so
      // NFS/SMB/container writes all land with the same ownership. Being on the allowed host list
      // is what actually grants access here, not a wider hole than that, since a host allowed onto
      // the mount at all was already being trusted with the whole share.
      const squashOpt = `,all_squash,anonuid=${config.arrayDataUid},anongid=${config.arrayDataGid}`;
      const opts = (s.nfs?.readOnly ? 'ro,sync,no_subtree_check' : 'rw,sync,no_subtree_check') + fsidOpt + squashOpt;
      for (const host of hosts) {
        lines.push(`${userMountPath(s.name)} ${host}(${opts})`);
      }
    }
    if (lines.length > 0) {
      // NFSv4 pseudo-filesystem root: without this, a client has to mount a share's real absolute
      // path (server:/mnt/user/<name>) - fsid=0 makes shareMountRoot itself the root a client sees
      // when it mounts "server:/", and `crossmnt` lets that resolution continue past the mount
      // boundary into each share's own separate mount underneath it (a bind mount or mergerfs FUSE
      // mount, not a real subdirectory of shareMountRoot), so `server:/<name>` alone resolves - the
      // same short form SMB already gets for free from its own share-name abstraction. Read-only
      // and `*` since nothing is ever written to shareMountRoot itself and real access control for
      // each share's actual content still lives entirely on that share's own export line above,
      // unaffected by this: a host not allowed on a given share still can't read/write into it -
      // crossmnt only makes the path resolvable, not the access grant. fsid=0 is reserved for
      // exactly this - see stableFsid()'s own doc comment on why per-share fsids are shifted off it.
      // NFSv3 clients are unaffected either way - v3 has no pseudo-root concept, so they keep
      // mounting the real absolute path regardless of this line.
      lines.unshift(`${config.shareMountRoot} *(ro,fsid=0,crossmnt,no_subtree_check,root_squash)`);
    }
    await replaceManagedBlock(config.exportsPath, lines);
    // best-effort - NFS kernel server may not be available in every environment
    await run('exportfs', ['-ra']).catch(() => {});
  }
}
