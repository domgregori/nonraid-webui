import { request } from './request';
import type { NmdCommandResult } from '../types/nmdApi';
import type { SelfTestType, SmartAttributes, SmartSpinState } from '../types/smart';

export const smartApi = {
  getTemperatures: () => request<Record<string, number | null>>('/api/smart/temperatures'),
  getHealthStatuses: () => request<Record<string, 'passed' | 'failed' | null>>('/api/smart/health'),
  getSpinStates: () => request<Record<string, SmartSpinState>>('/api/smart/spin-states'),
  getDiskTypes: () => request<Record<string, boolean | null>>('/api/smart/disk-types'),
  getDiskTransports: () => request<Record<string, string | null>>('/api/smart/disk-transports'),
  getAttributes: (slot: number) => request<SmartAttributes | null>(`/api/disks/${slot}/smart`),
  getAttributesByDevice: (device: string) => request<SmartAttributes | null>(`/api/smart/by-device?device=${encodeURIComponent(device)}`),
  startSelfTest: (slot: number, type: SelfTestType) =>
    request<NmdCommandResult>(`/api/disks/${slot}/smart/self-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type }),
    }),
};
