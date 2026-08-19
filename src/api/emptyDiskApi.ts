import { request } from './request';
import type { EmptyDiskJobState, EmptyDiskPlanSummary } from '../types/emptyDisk';

export const emptyDiskApi = {
  plan: (slot: number) => request<EmptyDiskPlanSummary>(`/api/disks/${slot}/empty/plan`, { method: 'POST' }),
  start: (slot: number) => request<{ ok: boolean; message: string }>(`/api/disks/${slot}/empty/start`, { method: 'POST' }),
  cancel: () => request<{ ok: boolean; message: string }>('/api/disks/empty/cancel', { method: 'POST' }),
  status: () => request<EmptyDiskJobState>('/api/disks/empty/status'),
};
