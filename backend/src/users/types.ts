export interface Group {
  name: string;
  gid: number;
}

export interface GroupInput {
  name: string;
}

export interface User {
  username: string;
  uid: number;
  groups: string[]; // secondary group names
}

export interface UserInput {
  username: string;
  password: string;
  groups: string[];
}

export interface UserUpdateInput {
  password?: string;
  groups?: string[];
}

export interface UserCommandResult {
  ok: boolean;
  message: string;
}

// What backupExport.ts's writeUsersExport() writes and restoreUsersExport() reads back - see
// config.ts's usersExportPath doc comment for why this exists as its own snapshot rather than
// trusting a live /etc/passwd restore. `shadowHash` is the raw /etc/shadow field (crypt(3) format,
// e.g. "$6$..."), null when getent shadow had nothing usable (locked account, empty field) - a
// restored user with a null hash comes back locked, same as it was.
export interface ManagedUserSnapshot {
  username: string;
  uid: number;
  groups: string[];
  shadowHash: string | null;
}

export interface ManagedGroupSnapshot {
  name: string;
  gid: number;
}

export interface UsersSnapshot {
  version: 1;
  users: ManagedUserSnapshot[];
  groups: ManagedGroupSnapshot[];
}

/** Per-account outcome of restoring a UsersSnapshot - a username/group name already existing on
 *  the target host is reported as skipped, not an error, since a restore commonly runs against a
 *  host that already has some of its own accounts (e.g. retrying after a partial restore). */
export interface UsersRestoreResult {
  usersCreated: string[];
  usersSkipped: string[];
  groupsCreated: string[];
  groupsSkipped: string[];
}
