import type { ActivityStore } from '../activity/index.js';
import type { ShareAccessStore } from '../shares/aclStore.js';
import type { ShareService } from '../shares/service.js';
import type { ShareStore } from '../shares/store.js';
import type { SharePermission } from '../shares/types.js';
import { HttpError } from '../httpError.js';
import type { UsersClient } from './client.js';
import type { PendingImportUsersStore } from './pendingImportStore.js';
import type { Group, User, UserCommandResult } from './types.js';
import { validateGroupInput, validatePermission, validateUserInput, validateUserUpdateInput } from './validate.js';

export interface ShareAccessEntry {
  shareName: string;
  permission: SharePermission;
}

export class UsersService {
  constructor(
    private client: UsersClient,
    private aclStore: ShareAccessStore,
    private shareStore: ShareStore,
    private shares: ShareService,
    private activity: ActivityStore,
    private pendingImport: PendingImportUsersStore,
  ) {}

  listUsers(): Promise<User[]> {
    return this.client.listUsers();
  }

  async createUser(input: unknown): Promise<User> {
    const userInput = validateUserInput(input);
    await this.assertManagedGroups(userInput.groups);
    const user = await this.client.createUser(userInput);
    this.activity.log(`User "${user.username}" created`, 'green').catch(() => {});
    return user;
  }

  async updateUser(username: string, input: unknown): Promise<User> {
    const updateInput = validateUserUpdateInput(input);
    if (updateInput.groups !== undefined) await this.assertManagedGroups(updateInput.groups);
    return this.client.updateUser(username, updateInput);
  }

  /**
   * Group names pass regex validation on shape alone, which isn't a privilege check - a
   * request could otherwise name a real pre-existing system group (docker, sudo, disk, ...)
   * and get a managed user added to it via usermod, which is effectively privilege escalation
   * (docker-group membership is root-equivalent). Only groups this app itself created
   * (gid in [config.usersUidRangeStart, config.usersUidRangeEnd]) are ever valid targets.
   */
  private async assertManagedGroups(groups: string[]): Promise<void> {
    const managed = new Set((await this.client.listGroups()).map((g) => g.name));
    const unmanaged = groups.filter((g) => !managed.has(g));
    if (unmanaged.length > 0) {
      throw new HttpError(400, `Unknown group(s): ${unmanaged.join(', ')}. Create them first from the Groups panel.`);
    }
  }

  async deleteUser(username: string): Promise<UserCommandResult> {
    const result = await this.client.deleteUser(username);
    await this.aclStore.removePrincipal('users', username);
    await this.shares.resyncExports();
    this.activity.log(`User "${username}" deleted`, 'red').catch(() => {});
    return result;
  }

  listGroups(): Promise<Group[]> {
    return this.client.listGroups();
  }

  async createGroup(input: unknown): Promise<Group> {
    const group = await this.client.createGroup(validateGroupInput(input));
    this.activity.log(`Group "${group.name}" created`, 'green').catch(() => {});
    return group;
  }

  async deleteGroup(name: string): Promise<UserCommandResult> {
    const result = await this.client.deleteGroup(name);
    await this.aclStore.removePrincipal('groups', name);
    await this.shares.resyncExports();
    this.activity.log(`Group "${name}" deleted`, 'red').catch(() => {});
    return result;
  }

  /** Every share's permission for this user, defaulting to 'none' where unset. */
  async getUserAccess(username: string): Promise<ShareAccessEntry[]> {
    if (!(await this.client.listUsers()).some((u) => u.username === username)) {
      throw new HttpError(404, `User "${username}" not found.`);
    }
    const [shares, allAccess] = await Promise.all([this.shareStore.list(), this.aclStore.getAll()]);
    return shares.map((s) => ({ shareName: s.name, permission: allAccess[s.name]?.users[username] ?? 'none' }));
  }

  async setUserAccess(username: string, shareName: string, permissionInput: unknown): Promise<void> {
    await this.setAccess('users', username, shareName, permissionInput);
  }

  async getGroupAccess(name: string): Promise<ShareAccessEntry[]> {
    if (!(await this.client.listGroups()).some((g) => g.name === name)) {
      throw new HttpError(404, `Group "${name}" not found.`);
    }
    const [shares, allAccess] = await Promise.all([this.shareStore.list(), this.aclStore.getAll()]);
    return shares.map((s) => ({ shareName: s.name, permission: allAccess[s.name]?.groups[name] ?? 'none' }));
  }

  async setGroupAccess(name: string, shareName: string, permissionInput: unknown): Promise<void> {
    await this.setAccess('groups', name, shareName, permissionInput);
  }

  listPendingImportUsers() {
    return this.pendingImport.getAll();
  }

  /**
   * Turns one "Import from Unraid" pending user into a real account, with the password the admin
   * just chose for it (a share never carries a secret, so this is the one part of that import that
   * always needs a person in the loop - see PendingImportUsersStore's own doc comment). Applies the
   * remembered read/write share list from the original import right away, write winning over read
   * where a share appears in both, then drops the pending entry either way - a failure after the
   * account itself is created still needs it gone, or every retry would try to create the same
   * username again and fail on "already exists" instead of finishing the access wiring.
   */
  async createUserFromPendingImport(username: string, password: string): Promise<User> {
    const pending = (await this.pendingImport.getAll()).find((u) => u.username === username);
    if (!pending) throw new HttpError(404, `"${username}" isn't a pending Unraid import.`);

    const user = await this.createUser({ username, password, groups: [] });
    try {
      for (const shareName of pending.readShares) {
        if (await this.shareStore.get(shareName)) await this.setUserAccess(username, shareName, 'read-only');
      }
      for (const shareName of pending.writeShares) {
        if (await this.shareStore.get(shareName)) await this.setUserAccess(username, shareName, 'read-write');
      }
    } finally {
      await this.pendingImport.remove(username);
    }
    return user;
  }

  discardPendingImportUser(username: string): Promise<void> {
    return this.pendingImport.remove(username);
  }

  private async setAccess(principalType: 'users' | 'groups', principal: string, shareName: string, permissionInput: unknown): Promise<void> {
    const permission = validatePermission(permissionInput);
    if (!(await this.shareStore.get(shareName))) {
      throw new HttpError(404, `Share "${shareName}" not found.`);
    }
    const exists =
      principalType === 'users'
        ? (await this.client.listUsers()).some((u) => u.username === principal)
        : (await this.client.listGroups()).some((g) => g.name === principal);
    if (!exists) {
      throw new HttpError(404, `${principalType === 'users' ? 'User' : 'Group'} "${principal}" not found.`);
    }

    // 'none' is stored explicitly, not treated as "no entry" - on a public share, an unset
    // entry defaults to the share's normal guest-open access, which is not the same thing as
    // an explicit deny. Entries are only ever cleared via removePrincipal, on user/group delete.
    await this.aclStore.setEntry(shareName, principalType, principal, permission);
    await this.shares.resyncExports();
  }
}
