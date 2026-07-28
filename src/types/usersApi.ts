// Mirrors backend/src/users/types.ts + the ACL portion of backend/src/shares/types.ts. Keep in sync.
export interface User {
  username: string;
  uid: number;
  groups: string[];
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

export interface Group {
  name: string;
  gid: number;
}

export interface GroupInput {
  name: string;
}

export type SharePermission = 'read-write' | 'read-only' | 'none' | 'hidden';

export interface ShareAccessEntry {
  shareName: string;
  permission: SharePermission;
}

export interface UserCommandResult {
  ok: boolean;
  message: string;
}
