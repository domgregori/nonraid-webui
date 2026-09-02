import { request } from './request';
import type {
  Group,
  GroupInput,
  ShareAccessEntry,
  SharePermission,
  User,
  UserCommandResult,
  UserInput,
  UserUpdateInput,
} from '../types/usersApi';
import type { PendingImportUser } from '../types/unraidImportApi';

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const usersApi = {
  list: () => request<User[]>('/api/users'),
  create: (input: UserInput) => request<User>('/api/users', jsonInit('POST', input)),
  update: (username: string, input: UserUpdateInput) => request<User>(`/api/users/${encodeURIComponent(username)}`, jsonInit('PUT', input)),
  remove: (username: string) => request<UserCommandResult>(`/api/users/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  getAccess: (username: string) => request<ShareAccessEntry[]>(`/api/users/${encodeURIComponent(username)}/access`),
  setAccess: (username: string, shareName: string, permission: SharePermission) =>
    request<{ ok: boolean }>(`/api/users/${encodeURIComponent(username)}/access/${encodeURIComponent(shareName)}`, jsonInit('PUT', { permission })),
  listPendingImport: () => request<PendingImportUser[]>('/api/users/pending-import'),
  createFromPendingImport: (username: string, password: string) =>
    request<User>(`/api/users/pending-import/${encodeURIComponent(username)}`, jsonInit('POST', { password })),
  discardPendingImport: (username: string) =>
    request<{ ok: boolean }>(`/api/users/pending-import/${encodeURIComponent(username)}`, { method: 'DELETE' }),
};

export const groupsApi = {
  list: () => request<Group[]>('/api/groups'),
  create: (input: GroupInput) => request<Group>('/api/groups', jsonInit('POST', input)),
  remove: (name: string) => request<UserCommandResult>(`/api/groups/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  getAccess: (name: string) => request<ShareAccessEntry[]>(`/api/groups/${encodeURIComponent(name)}/access`),
  setAccess: (name: string, shareName: string, permission: SharePermission) =>
    request<{ ok: boolean }>(`/api/groups/${encodeURIComponent(name)}/access/${encodeURIComponent(shareName)}`, jsonInit('PUT', { permission })),
};
