import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { config } from '../config.js';

// The setgid bit's mode value - node:fs's own `constants` exposes S_IRWXU/S_IRWXG/etc. but not the
// special bits (setuid/setgid/sticky), so this is the raw POSIX value directly.
const S_ISGID = 0o2000;

const execFileAsync = promisify(execFile);

async function run(bin: string, args: string[], timeout = 15_000): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(bin, args, {
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    throw new Error(e.stderr?.trim() || e.stdout?.trim() || e.message);
  }
}

// find/setfacl below walk every file and directory already under dirPath, not just dirPath
// itself - fine for a fresh, empty share, but a share pointed at real pre-existing data can be
// enormous (confirmed live: a Proxmox Backup Server chunk store and a media library each around
// 150,000 files/directories) and takes real minutes to walk, not the 15s mkdir/chown (which only
// ever touch dirPath itself, never recurse) reasonably need. Generous rather than unbounded - a
// share creation that's *genuinely* hung should still fail eventually instead of blocking forever.
const RECURSIVE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Whether `dirPath` itself already carries the setgid bit the recursive walk below sets on every
 * directory in the tree - used as a cheap stand-in for "has this whole tree already been
 * provisioned", so a share that's been mounted before doesn't pay for a multi-minute walk of a
 * 150,000-entry tree on every single mount (confirmed live: this ran on every backend restart via
 * remountAll(), not just once ever, since mountShare() calls provisionArrayDir() unconditionally
 * for every branch every time). Just a stat(), never recurses.
 */
async function isAlreadyProvisioned(dirPath: string): Promise<boolean> {
  try {
    return ((await stat(dirPath)).mode & S_ISGID) !== 0;
  } catch {
    return false;
  }
}

/**
 * Creates `dirPath` if missing and makes it (and everything created under it afterward - by this
 * app, Samba, NFS, or a Docker/LXC container bind-mounting it) owned by
 * config.arrayDataOwner/Group - the classic linuxserver.io nobody:users (99:100) convention most
 * Community-Apps containers already default their own PUID/PGID to. The default ACL (`-d`) is
 * what makes this apply to *new* content going forward too, not just this one directory: POSIX
 * default ACLs are inherited by every file/subdirectory created under it afterward, regardless of
 * which uid actually creates them - so Browse's own mkdir/upload, a Samba write, or a
 * bind-mounted container's write all land with the same access without this app needing to chown
 * after every individual create call.
 *
 * Shared by shares/applier/realApplier.ts's mountShare() (per-branch share directories) and
 * apps/service.ts's container install flow (bind-mount host paths, e.g. appdata) - anywhere this
 * app hands a directory to something else (Samba, Docker, LXC) that might create it itself with
 * plain root ownership and no ACL if this app doesn't get there first. Docker in particular always
 * auto-creates a missing bind-mount source path as root:root with no ACL the moment a container
 * using it starts - calling this first prevents that, rather than fixing it up after the fact.
 *
 * The recursive setgid+ACL walk below only actually runs the first time a given `dirPath` is
 * provisioned (see isAlreadyProvisioned) - every call after that is just the cheap non-recursive
 * mkdir/chown/chmod/setfacl on `dirPath` itself, none of which recurse. This is still correct for
 * everything created afterward: setgid on a directory and a POSIX default ACL are both inherited
 * by the kernel on every subdirectory/file created under it from then on, regardless of which
 * process creates it (this app, Samba, NFS, a bind-mounted container) - the one-time walk exists
 * purely to catch *pre-existing* content that predates this app managing the directory (an
 * Unraid-imported share, data copied in some other way), not content created afterward, which
 * never needed re-walking on every mount to begin with. The one gap this deliberately accepts:
 * files placed directly on a disk through some path entirely outside this app (e.g. a raw `cp` over
 * SSH, bypassing Samba/NFS/Browse) after the first provision won't get auto-repaired by a later
 * mount the way they used to - confirmed worth accepting live: this walk previously reran in full
 * on every single backend restart, turning a routine deploy into a multi-minute wait on a share
 * with a large pre-existing tree (a Proxmox Backup Server chunk store, ~150,000 files).
 */
export async function provisionArrayDir(dirPath: string): Promise<void> {
  await run('mkdir', ['-p', dirPath]);
  await run('chown', [`${config.arrayDataOwner}:${config.arrayDataGroup}`, dirPath]);

  // Checked before this function's own chmod below would otherwise set the bit and make every
  // call look "already provisioned" to itself.
  const alreadyProvisioned = await isAlreadyProvisioned(dirPath);

  // Non-recursive, always cheap - keeps dirPath itself correct even on a call that skips the walk
  // below, and is exactly what isAlreadyProvisioned() checks for on the *next* call.
  await run('chmod', ['g+s', dirPath]);
  const acl = `u:${config.arrayDataOwner}:rwx,g:${config.arrayDataGroup}:rwx`;
  await run('setfacl', ['-m', acl, '-d', '-m', acl, dirPath]);

  if (alreadyProvisioned) return;

  // Setgid on every directory in the tree (not just dirPath itself) - Linux propagates it to every
  // new subdirectory created afterward, so group=users is correct forever with no per-call-site
  // code, even for content this backend's own root process creates directly (browse/service.ts,
  // fileMove/service.ts). Only directories, not files - `find -type d` avoids setting the same bit
  // on a regular file, where it means something unrelated (mandatory locking).
  await run('find', [dirPath, '-type', 'd', '-exec', 'chmod', 'g+s', '{}', '+'], RECURSIVE_TIMEOUT_MS);
  await run('setfacl', ['-R', '-m', acl, '-d', '-m', acl, dirPath], RECURSIVE_TIMEOUT_MS);
}
