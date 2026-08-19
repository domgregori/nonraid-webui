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
