import type { AppUser } from '../types';

export const USERS: AppUser[] = [
  { name: 'admin', role: 'Administrator', access: 'All shares', lastLogin: '2h ago' },
  { name: 'jsmith', role: 'Read/Write', access: 'media, documents', lastLogin: '1d ago' },
  { name: 'backup-svc', role: 'Read/Write', access: 'backups', lastLogin: '6h ago' },
  { name: 'guest', role: 'Read only', access: 'media', lastLogin: '—' },
];
