export type UserRole = 'Administrator' | 'Read/Write' | 'Read only';

export interface AppUser {
  name: string;
  role: UserRole;
  access: string;
  lastLogin: string;
}

export interface UserViewModel extends AppUser {
  initial: string;
  roleColor: string;
}
