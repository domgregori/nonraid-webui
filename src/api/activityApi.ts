import { request } from './request';
import type { ActivityEntry } from '../types/activityApi';

export const activityApi = {
  list: (limit?: number) => request<ActivityEntry[]>(`/api/activity${limit ? `?limit=${limit}` : ''}`),
};
