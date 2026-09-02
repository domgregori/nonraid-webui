import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';

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
 */
export async function provisionArrayDir(dirPath: string): Promise<void> {
  await run('mkdir', ['-p', dirPath]);
  await run('chown', [`${config.arrayDataOwner}:${config.arrayDataGroup}`, dirPath]);
  // Setgid on every directory in the tree (not just dirPath itself) - Linux propagates it to every
  // new subdirectory created afterward, so group=users is correct forever with no per-call-site
  // code, even for content this backend's own root process creates directly (browse/service.ts,
  // fileMove/service.ts). Only directories, not files - `find -type d` avoids setting the same bit
  // on a regular file, where it means something unrelated (mandatory locking).
  await run('find', [dirPath, '-type', 'd', '-exec', 'chmod', 'g+s', '{}', '+'], RECURSIVE_TIMEOUT_MS);
  const acl = `u:${config.arrayDataOwner}:rwx,g:${config.arrayDataGroup}:rwx`;
  await run('setfacl', ['-R', '-m', acl, '-d', '-m', acl, dirPath], RECURSIVE_TIMEOUT_MS);
}
