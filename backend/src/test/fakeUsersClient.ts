import type { UsersClient } from '../users/client.js';
import type { Group, GroupInput, User, UserCommandResult, UserInput, UserUpdateInput } from '../users/types.js';

export const usersFixture: User[] = [
  { username: 'alice', uid: 20000, groups: ['family'] },
  { username: 'bob', uid: 20001, groups: [] },
];

export const groupsFixture: Group[] = [{ name: 'family', gid: 20000 }];

const defaults = {
  listUsers: async (): Promise<User[]> => structuredClone(usersFixture),
  createUser: async (input: UserInput): Promise<User> => ({
    username: input.username,
    uid: 20002,
    groups: [...input.groups],
  }),
  updateUser: async (username: string, input: UserUpdateInput): Promise<User> => ({
    username,
    uid: 20000,
    groups: input.groups ? [...input.groups] : [],
  }),
  deleteUser: async (username: string): Promise<UserCommandResult> => ({ ok: true, message: `User "${username}" deleted` }),
  listGroups: async (): Promise<Group[]> => structuredClone(groupsFixture),
  createGroup: async (input: GroupInput): Promise<Group> => ({ name: input.name, gid: 20001 }),
  deleteGroup: async (name: string): Promise<UserCommandResult> => ({ ok: true, message: `Group "${name}" deleted` }),
} satisfies UsersClient;

/** Builds an in-memory UsersClient fake; pass overrides to customize one method per test. */
export function createFakeUsersClient(overrides: Partial<UsersClient> = {}): UsersClient {
  return { ...defaults, ...overrides };
}
