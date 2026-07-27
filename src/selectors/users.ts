import { COLORS } from '../styles/colors';
import type { AppUser, UserRole, UserViewModel } from '../types';

const ROLE_COLORS: Record<UserRole, string> = {
  Administrator: COLORS.blue,
  'Read/Write': COLORS.green,
  'Read only': COLORS.textDim,
};

export function deriveUserViewModel(user: AppUser): UserViewModel {
  return {
    ...user,
    initial: user.name[0].toUpperCase(),
    roleColor: ROLE_COLORS[user.role] ?? COLORS.textSecondary,
  };
}
