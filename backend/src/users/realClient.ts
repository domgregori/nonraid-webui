import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import type { UsersClient } from './client.js';
import type { Group, GroupInput, User, UserCommandResult, UserInput, UsersRestoreResult, UsersSnapshot, UserUpdateInput } from './types.js';

const execFileAsync = promisify(execFile);

async function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(bin, args, {
      timeout: config.usersTimeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    throw new Error(e.stderr?.trim() || e.stdout?.trim() || e.message);
  }
}

/**
 * Same shape as nmd's writeNmdCmd: passwords must never appear in argv (visible to
 * any other process via `ps`), so chpasswd/smbpasswd take them on stdin instead.
 */
async function runWithStdin(bin: string, args: string[], stdin: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { timeout: config.usersTimeoutMs });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${bin} exited with code ${code}`));
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

async function setUnixPassword(username: string, password: string): Promise<void> {
  await runWithStdin('chpasswd', [], `${username}:${password}\n`);
}

async function setSambaPassword(username: string, password: string): Promise<void> {
  // -s reads the new password twice from stdin instead of prompting interactively.
  await runWithStdin('smbpasswd', ['-a', '-s', username], `${password}\n${password}\n`);
}

/** The raw /etc/shadow hash field for `username` (crypt(3) format) - null for a locked/disabled
 *  account (a leading "!") or one with no password set at all ("*" or empty), same "nothing
 *  meaningful to restore" reasoning either way. Read via getent rather than parsing /etc/shadow
 *  directly, same NSS-aware convention every other lookup in this file already uses. */
async function getShadowHash(username: string): Promise<string | null> {
  try {
    const { stdout } = await run('getent', ['shadow', username]);
    const hash = stdout.trim().split(':')[1];
    return hash && hash !== '!' && hash !== '*' ? hash : null;
  } catch {
    return null;
  }
}

/** Sets a user's /etc/shadow entry directly from an already-hashed value (chpasswd's own -e flag)
 *  - restoreSnapshot()'s way of putting a captured shadow hash back without ever needing the
 *  original plaintext password, same "never touches argv, always stdin" discipline as
 *  setUnixPassword()/setSambaPassword() above. */
async function setShadowHash(username: string, hash: string): Promise<void> {
  await runWithStdin('chpasswd', ['-e'], `${username}:${hash}\n`);
}

function parseGetentPasswd(
  stdout: string,
  uidRangeStart: number,
  uidRangeEnd: number,
): { username: string; uid: number }[] {
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [username, , uidStr] = line.split(':');
      return { username: username!, uid: Number(uidStr) };
    })
    .filter((u) => Number.isInteger(u.uid) && u.uid >= uidRangeStart && u.uid <= uidRangeEnd);
}

function parseGetentGroup(stdout: string): { name: string; gid: number; members: string[] }[] {
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, , gidStr, membersStr] = line.split(':');
      return {
        name: name!,
        gid: Number(gidStr),
        members: membersStr ? membersStr.split(',').filter(Boolean) : [],
      };
    });
}

/**
 * Shells out to real useradd/usermod/userdel/groupadd/groupdel/chpasswd/smbpasswd.
 * The host's /etc/passwd + /etc/group (via getent, which also covers NSS sources
 * like LDAP if configured) are the source of truth for who exists - no separate
 * JSON cache to drift out of sync with. Only accounts with uid/gid in
 * [config.usersUidRangeStart, config.usersUidRangeEnd] are considered "managed"
 * (listed, editable, deletable) so this can never touch real host system
 * accounts. The upper bound matters: without it, reserved accounts like
 * `nobody`/`nogroup` (uid/gid 65534 on Linux) satisfy a plain ">= start" check
 * and get misidentified as app-managed - confirmed live on a real host.
 */
export class RealUsersClient implements UsersClient {

  private async allGroups() {
    const { stdout } = await run('getent', ['group']);
    return parseGetentGroup(stdout);
  }

  private async managedGroups() {
    return (await this.allGroups()).filter(
      (g) => g.gid >= config.usersUidRangeStart && g.gid <= config.usersUidRangeEnd,
    );
  }

  private async nextUid(): Promise<number> {
    const users = await this.listUsers();
    const max = users.reduce((m, u) => Math.max(m, u.uid), config.usersUidRangeStart - 1);
    return max + 1;
  }

  private async nextGid(): Promise<number> {
    const groups = await this.managedGroups();
    const max = groups.reduce((m, g) => Math.max(m, g.gid), config.usersUidRangeStart - 1);
    return max + 1;
  }

  async listUsers(): Promise<User[]> {
    const [{ stdout }, groups] = await Promise.all([run('getent', ['passwd']), this.managedGroups()]);
    const users = parseGetentPasswd(stdout, config.usersUidRangeStart, config.usersUidRangeEnd);
    return users.map((u) => ({
      username: u.username,
      uid: u.uid,
      groups: groups.filter((g) => g.members.includes(u.username)).map((g) => g.name),
    }));
  }

  async createUser(input: UserInput): Promise<User> {
    if ((await this.listUsers()).some((u) => u.username === input.username)) {
      throw new HttpError(409, `User "${input.username}" already exists.`);
    }

    const uid = await this.nextUid();
    // -N: don't auto-create a same-name private group. Without this, useradd creates
    // one with a gid that often lands inside our managed range (confirmed live - it
    // frequently matches the new uid), making it indistinguishable from a real
    // app-created group and cluttering the group list with one-off noise per user.
    await run('useradd', ['-u', String(uid), '-N', '-M', '-s', config.usersShellPath, input.username]);
    await setUnixPassword(input.username, input.password);
    await setSambaPassword(input.username, input.password);
    if (input.groups.length > 0) {
      await run('usermod', ['-aG', input.groups.join(','), input.username]);
    }

    return { username: input.username, uid, groups: input.groups };
  }

  async updateUser(username: string, input: UserUpdateInput): Promise<User> {
    const users = await this.listUsers();
    const existing = users.find((u) => u.username === username);
    if (!existing) {
      throw new HttpError(404, `User "${username}" not found.`);
    }

    if (input.password !== undefined) {
      await setUnixPassword(username, input.password);
      await setSambaPassword(username, input.password);
    }

    let groups = existing.groups;
    if (input.groups !== undefined) {
      // Only replace membership in managed (webui-created) groups - preserve any
      // other secondary group membership the account happens to have.
      const allGroups = await this.allGroups();
      const managedNames = new Set((await this.managedGroups()).map((g) => g.name));
      const nonManaged = allGroups.filter((g) => g.members.includes(username) && !managedNames.has(g.name)).map((g) => g.name);
      groups = input.groups;
      const merged = [...nonManaged, ...input.groups];
      await run('usermod', ['-G', merged.join(','), username]);
    }

    return { username, uid: existing.uid, groups };
  }

  async deleteUser(username: string): Promise<UserCommandResult> {
    if (!(await this.listUsers()).some((u) => u.username === username)) {
      throw new HttpError(404, `User "${username}" not found.`);
    }
    await run('smbpasswd', ['-x', username]).catch(() => {
      // fine if the account was never in the samba passdb
    });
    await run('userdel', [username]);
    return { ok: true, message: `User "${username}" deleted` };
  }

  async listGroups(): Promise<Group[]> {
    return (await this.managedGroups()).map(({ name, gid }) => ({ name, gid }));
  }

  async createGroup(input: GroupInput): Promise<Group> {
    if ((await this.listGroups()).some((g) => g.name === input.name)) {
      throw new HttpError(409, `Group "${input.name}" already exists.`);
    }
    const gid = await this.nextGid();
    await run('groupadd', ['-g', String(gid), input.name]);
    return { name: input.name, gid };
  }

  async deleteGroup(name: string): Promise<UserCommandResult> {
    if (!(await this.listGroups()).some((g) => g.name === name)) {
      throw new HttpError(404, `Group "${name}" not found.`);
    }
    await run('groupdel', [name]);
    return { ok: true, message: `Group "${name}" deleted` };
  }

  async exportSnapshot(): Promise<UsersSnapshot> {
    const [users, groups] = await Promise.all([this.listUsers(), this.listGroups()]);
    const withHashes = await Promise.all(users.map(async (u) => ({ ...u, shadowHash: await getShadowHash(u.username) })));
    return { version: 1, users: withHashes, groups };
  }

  async restoreSnapshot(snapshot: UsersSnapshot): Promise<UsersRestoreResult> {
    const groupsCreated: string[] = [];
    const groupsSkipped: string[] = [];
    for (const g of snapshot.groups) {
      try {
        await run('groupadd', ['-g', String(g.gid), g.name]);
        groupsCreated.push(g.name);
      } catch {
        // already exists, or the gid is taken by something else - either way nothing to recreate
        groupsSkipped.push(g.name);
      }
    }

    const usersCreated: string[] = [];
    const usersSkipped: string[] = [];
    for (const u of snapshot.users) {
      try {
        // Same useradd shape as createUser() above, minus setUnixPassword()/setSambaPassword() -
        // this implants the captured shadow hash directly instead (below), and leaves the samba
        // side to the 'users' category's other member, passdb.tdb, restored wholesale alongside
        // this snapshot (see config.ts's sambaPasswdPath doc comment).
        await run('useradd', ['-u', String(u.uid), '-N', '-M', '-s', config.usersShellPath, u.username]);
        if (u.groups.length > 0) {
          await run('usermod', ['-aG', u.groups.join(','), u.username]).catch(() => {});
        }
        if (u.shadowHash) {
          await setShadowHash(u.username, u.shadowHash).catch(() => {});
        }
        usersCreated.push(u.username);
      } catch {
        // already exists, or the uid is taken by something else - either way nothing to recreate
        usersSkipped.push(u.username);
      }
    }

    return { usersCreated, usersSkipped, groupsCreated, groupsSkipped };
  }
}
