import { request } from './request';
import type { NmdCommandResult } from '../types/nmdApi';
import type { SelfTestType, SmartAttributes } from '../types/smart';

export const smartApi = {
  getTemperatures: () => request<Record<string, number | null>>('/api/smart/temperatures'),
  getAttributes: (slot: number) => request<SmartAttributes | null>(`/api/disks/${slot}/smart`),
  startSelfTest: (slot: number, type: SelfTestType) =>
    request<NmdCommandResult>(`/api/disks/${slot}/smart/self-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type }),
    }),
};
