import { request } from './request';
import type { ImportResult, NmdCommandResult, NmdStatusResponse, ParityCheckAction } from '../types/nmdApi';

export const nmdApi = {
  getStatus: () => request<NmdStatusResponse>('/api/status'),
  startArray: () => request<NmdCommandResult>('/api/array/start', { method: 'POST' }),
  stopArray: () => request<NmdCommandResult>('/api/array/stop', { method: 'POST' }),
  importDisks: () => request<ImportResult>('/api/array/import', { method: 'POST' }),
  parityCheck: (action: ParityCheckAction) => request<NmdCommandResult>(`/api/parity/${action}`, { method: 'POST' }),
  unassignDisk: (slot: number) => request<NmdCommandResult>(`/api/disks/${slot}/unassign`, { method: 'POST' }),
  setLabel: (label: string) =>
    request<NmdCommandResult>('/api/array/label', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label }),
    }),
};
