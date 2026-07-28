import { config } from '../config.js';
import { HttpError } from '../httpError.js';
import type { UsersClient } from './client.js';
import type { Group, GroupInput, User, UserCommandResult, UserInput, UserUpdateInput } from './types.js';

export class MockUsersClient implements UsersClient {
  readonly mode = 'mock' as const;
  private users: User[] = [
    { username: 'jsmith', uid: config.usersUidRangeStart, groups: ['media-users'] },
    { username: 'backup-svc', uid: config.usersUidRangeStart + 1, groups: [] },
  ];
  private groups: Group[] = [{ name: 'media-users', gid: config.usersUidRangeStart }];

  private nextUid(): number {
    return this.users.reduce((m, u) => Math.max(m, u.uid), config.usersUidRangeStart - 1) + 1;
  }

  private nextGid(): number {
    return this.groups.reduce((m, g) => Math.max(m, g.gid), config.usersUidRangeStart - 1) + 1;
  }

  async listUsers(): Promise<User[]> {
    return this.users.map((u) => ({ ...u, groups: [...u.groups] }));
  }

  async createUser(input: UserInput): Promise<User> {
    if (this.users.some((u) => u.username === input.username)) {
      throw new HttpError(409, `User "${input.username}" already exists.`);
    }
    const user: User = { username: input.username, uid: this.nextUid(), groups: [...input.groups] };
    this.users.push(user);
    return { ...user };
  }

  async updateUser(username: string, input: UserUpdateInput): Promise<User> {
    const user = this.users.find((u) => u.username === username);
    if (!user) throw new HttpError(404, `User "${username}" not found.`);
    if (input.groups !== undefined) user.groups = [...input.groups];
    return { ...user, groups: [...user.groups] };
  }

  async deleteUser(username: string): Promise<UserCommandResult> {
    const idx = this.users.findIndex((u) => u.username === username);
    if (idx === -1) throw new HttpError(404, `User "${username}" not found.`);
    this.users.splice(idx, 1);
    return { ok: true, message: `User "${username}" deleted (mock)` };
  }

  async listGroups(): Promise<Group[]> {
    return this.groups.map((g) => ({ ...g }));
  }

  async createGroup(input: GroupInput): Promise<Group> {
    if (this.groups.some((g) => g.name === input.name)) {
      throw new HttpError(409, `Group "${input.name}" already exists.`);
    }
    const group: Group = { name: input.name, gid: this.nextGid() };
    this.groups.push(group);
    return { ...group };
  }

  async deleteGroup(name: string): Promise<UserCommandResult> {
    const idx = this.groups.findIndex((g) => g.name === name);
    if (idx === -1) throw new HttpError(404, `Group "${name}" not found.`);
    this.groups.splice(idx, 1);
    for (const u of this.users) u.groups = u.groups.filter((g) => g !== name);
    return { ok: true, message: `Group "${name}" deleted (mock)` };
  }
}
