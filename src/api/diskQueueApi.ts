import { request } from './request';
import type { DiskQueueItem, DiskQueueState } from '../types/diskQueue';

export const diskQueueApi = {
  getStatus: () => request<DiskQueueState>('/api/disk-queue/status'),
  enqueueParity: (device: string) =>
    request<DiskQueueItem>('/api/disk-queue/parity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device }),
    }),
  enqueueData: (device: string) =>
    request<DiskQueueItem>('/api/disk-queue/data', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device }),
    }),
  enqueueCacheMirror: (deviceA: string, deviceB: string) =>
    request<DiskQueueItem>('/api/disk-queue/cache-mirror', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceA, deviceB }),
    }),
  retry: (id: string) => request<DiskQueueItem>(`/api/disk-queue/${id}/retry`, { method: 'POST' }),
  remove: (id: string) => request<{ ok: boolean }>(`/api/disk-queue/${id}`, { method: 'DELETE' }),
  clear: () => request<{ ok: boolean }>('/api/disk-queue/clear', { method: 'POST' }),
};
