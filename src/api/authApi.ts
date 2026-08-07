import { request } from './request';
import type { AuthStatusResponse } from '../types/authApi';

export const authApi = {
  status: () => request<AuthStatusResponse>('/api/auth/status'),
  setup: (username: string, password: string) =>
    request<AuthStatusResponse>('/api/auth/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    request<AuthStatusResponse>('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<AuthStatusResponse>('/api/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<AuthStatusResponse>('/api/auth/password', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};
