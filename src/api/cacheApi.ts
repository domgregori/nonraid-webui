import { request } from './request';
import type { CacheCommandResult, CacheMoverJobState, CacheReplaceStatus, CacheStatus } from '../types/cacheApi';

export const cacheApi = {
  getStatus: () => request<CacheStatus>('/api/cache/status'),
  setup: (deviceA: string, deviceB: string, force = false) =>
    request<CacheCommandResult>('/api/cache/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceA, deviceB, force }),
    }),
  replaceDevice: (device: string) =>
    request<CacheCommandResult>('/api/cache/replace', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device }),
    }),
  getReplaceStatus: () => request<CacheReplaceStatus>('/api/cache/replace/status'),
  setEnabled: (enabled: boolean) =>
    request<CacheCommandResult>('/api/cache/enabled', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }),
  runMover: () => request<CacheCommandResult>('/api/cache/mover/run', { method: 'POST' }),
  getMoverStatus: () => request<CacheMoverJobState>('/api/cache/mover/status'),
  cancelMover: () => request<CacheCommandResult>('/api/cache/mover/cancel', { method: 'POST' }),
};
