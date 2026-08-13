import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import type { UsersClient } from './client.js';
import type { Group, GroupInput, User, UserCommandResult, UserInput, UserUpdateInput } from './types.js';

const execFileAsync = promisify(execFile);

async function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const useSudo = config.usersUseSudo;
  try {
    return await execFileAsync(useSudo ? 'sudo' : bin, useSudo ? [bin, ...args] : args, {
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
  const useSudo = config.usersUseSudo;
  const spawnBin = useSudo ? 'sudo' : bin;
  const spawnArgs = useSudo ? [bin, ...args] : args;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(spawnBin, spawnArgs, { timeout: config.usersTimeoutMs });
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
}
