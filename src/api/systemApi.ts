import { API_BASE_URL } from './config';
import { request } from './request';
import type { BenchmarkResult } from '../types/benchmark';
import type { CommandResult } from '../types/settingsApi';
import type { SystemStats } from '../types/systemApi';

export const systemApi = {
  getStats: () => request<SystemStats>('/api/system'),

  bootDiskImageBackupUrl: () => `${API_BASE_URL}/api/system/boot-disk/backup/image`,
  bootDiskConfigBackupUrl: () => `${API_BASE_URL}/api/system/boot-disk/backup/config`,

  getTimezones: () => request<string[]>('/api/system/timezones'),
  setHostname: (hostname: string) =>
    request<CommandResult>('/api/system/hostname', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hostname }),
    }),
  setTimezone: (timezone: string) =>
    request<CommandResult>('/api/system/timezone', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timezone }),
    }),

  benchmarkBootRead: () => request<BenchmarkResult>('/api/system/boot-disk/benchmark/read', { method: 'POST' }),
  benchmarkBootWrite: () => request<BenchmarkResult>('/api/system/boot-disk/benchmark/write', { method: 'POST' }),
};
