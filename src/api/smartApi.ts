import { request } from './request';

export const smartApi = {
  getTemperatures: () => request<Record<string, number | null>>('/api/smart/temperatures'),
};
