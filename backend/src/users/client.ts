import type { Group, GroupInput, User, UserCommandResult, UserInput, UsersSnapshot, UsersRestoreResult, UserUpdateInput } from './types.js';

export interface UsersClient {
  listUsers(): Promise<User[]>;
  createUser(input: UserInput): Promise<User>;
  updateUser(username: string, input: UserUpdateInput): Promise<User>;
  deleteUser(username: string): Promise<UserCommandResult>;
  listGroups(): Promise<Group[]>;
  createGroup(input: GroupInput): Promise<Group>;
  deleteGroup(name: string): Promise<UserCommandResult>;
  /** Every managed user/group plus each user's own /etc/shadow hash - see types.ts's
   *  UsersSnapshot doc comment. */
  exportSnapshot(): Promise<UsersSnapshot>;
  /** Recreates whatever's missing from a snapshot - existing accounts are left untouched, not
   *  overwritten, see types.ts's UsersRestoreResult doc comment. */
  restoreSnapshot(snapshot: UsersSnapshot): Promise<UsersRestoreResult>;
}
