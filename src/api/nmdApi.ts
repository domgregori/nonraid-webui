import { request } from './request';
import type { BenchmarkResult } from '../types/benchmark';
import type {
  AddDiskResult,
  AvailableDevice,
  ImportCommitResponse,
  ImportPreview,
  NmdCommandResult,
  NmdStatusResponse,
  ParityCheckAction,
} from '../types/nmdApi';

export const nmdApi = {
  getStatus: () => request<NmdStatusResponse>('/api/status'),
  startArray: () => request<NmdCommandResult>('/api/array/start', { method: 'POST' }),
  stopArray: () => request<NmdCommandResult>('/api/array/stop', { method: 'POST' }),
  previewImport: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<ImportPreview>('/api/array/import/preview', { method: 'POST', body: form });
  },
  commitImport: (token: string) =>
    request<ImportCommitResponse>('/api/array/import/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    }),
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
  mountDisk: (slot: number) => request<NmdCommandResult>(`/api/disks/${slot}/mount`, { method: 'POST' }),
  spinDownDisk: (slot: number) => request<NmdCommandResult>(`/api/disks/${slot}/spin-down`, { method: 'POST' }),
  spinUpDisk: (slot: number) => request<NmdCommandResult>(`/api/disks/${slot}/spin-up`, { method: 'POST' }),
  benchmarkRead: (slot: number, durationSeconds: number) =>
    request<BenchmarkResult>(`/api/disks/${slot}/benchmark/read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ durationSeconds }),
    }),
  benchmarkWrite: (slot: number, durationSeconds: number) =>
    request<BenchmarkResult>(`/api/disks/${slot}/benchmark/write`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ durationSeconds }),
    }),
  benchmarkReadDevice: (device: string, durationSeconds: number) =>
    request<BenchmarkResult>('/api/disks/benchmark/read-device', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device, durationSeconds }),
    }),
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
  reloadDriver: () => request<NmdCommandResult>('/api/array/reload-driver', { method: 'POST' }),
  setLabel: (label: string) =>
    request<NmdCommandResult>('/api/array/label', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label }),
    }),
};
