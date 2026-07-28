import { COLORS } from '../styles/colors';
import type { SharePermission, User } from '../types/usersApi';

export interface UserViewModel extends User {
  initial: string;
  groupsLabel: string;
}

export function deriveUserViewModel(user: User): UserViewModel {
  return {
    ...user,
    initial: user.username[0]!.toUpperCase(),
    groupsLabel: user.groups.length > 0 ? user.groups.join(', ') : 'No groups',
  };
}

export const PERMISSION_LABELS: Record<SharePermission, string> = {
  'read-write': 'Read/Write',
  'read-only': 'Read only',
  none: 'No access',
  hidden: 'Hidden',
};

export const PERMISSION_COLORS: Record<SharePermission, string> = {
  'read-write': COLORS.green,
  'read-only': COLORS.blue,
  none: COLORS.textDim,
  hidden: COLORS.red,
};
