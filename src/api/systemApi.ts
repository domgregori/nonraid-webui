import { API_BASE_URL } from './config';
import { request } from './request';
import type { SystemStats } from '../types/systemApi';

export const systemApi = {
  getStats: () => request<SystemStats>('/api/system'),

  bootDiskImageBackupUrl: () => `${API_BASE_URL}/api/system/boot-disk/backup/image`,
  bootDiskConfigBackupUrl: () => `${API_BASE_URL}/api/system/boot-disk/backup/config`,
};
