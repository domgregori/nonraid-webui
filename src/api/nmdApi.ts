import { request } from './request';
import type { AddDiskResult, AvailableDevice, ImportResult, NmdCommandResult, NmdStatusResponse, ParityCheckAction } from '../types/nmdApi';

export const nmdApi = {
  getStatus: () => request<NmdStatusResponse>('/api/status'),
  startArray: () => request<NmdCommandResult>('/api/array/start', { method: 'POST' }),
  stopArray: () => request<NmdCommandResult>('/api/array/stop', { method: 'POST' }),
  importDisks: () => request<ImportResult>('/api/array/import', { method: 'POST' }),
  parityCheck: (action: ParityCheckAction) => request<NmdCommandResult>(`/api/parity/${action}`, { method: 'POST' }),
  unassignDisk: (slot: number) => request<NmdCommandResult>(`/api/disks/${slot}/unassign`, { method: 'POST' }),
  listAvailableDevices: () => request<AvailableDevice[]>('/api/disks/available'),
  addDisk: (slot: number, device: string) =>
    request<AddDiskResult>(`/api/disks/${slot}/add`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device }),
    }),
  formatDisk: (slot: number) => request<NmdCommandResult>(`/api/disks/${slot}/format`, { method: 'POST' }),
  replaceDisk: (slot: number, device: string) =>
    request<AddDiskResult>(`/api/disks/${slot}/replace`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device }),
    }),
  restoreDisk: (slot: number) => request<NmdCommandResult>(`/api/disks/${slot}/restore`, { method: 'POST' }),
  shrinkArray: (dropSlots: number[]) =>
    request<NmdCommandResult>('/api/array/shrink', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dropSlots }),
    }),
  setLabel: (label: string) =>
    request<NmdCommandResult>('/api/array/label', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label }),
    }),
};
