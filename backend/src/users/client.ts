import type { Group, GroupInput, User, UserCommandResult, UserInput, UserUpdateInput } from './types.js';

export interface UsersClient {
  readonly mode: 'real' | 'mock';
  listUsers(): Promise<User[]>;
  createUser(input: UserInput): Promise<User>;
  updateUser(username: string, input: UserUpdateInput): Promise<User>;
  deleteUser(username: string): Promise<UserCommandResult>;
  listGroups(): Promise<Group[]>;
  createGroup(input: GroupInput): Promise<Group>;
  deleteGroup(name: string): Promise<UserCommandResult>;
}
