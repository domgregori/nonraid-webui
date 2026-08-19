import { request } from './request';
import type { ServiceCommandResult, ServiceStatus } from '../types/servicesApi';

export const servicesApi = {
  list: () => request<ServiceStatus[]>('/api/services'),
  start: (id: string) => request<ServiceCommandResult>(`/api/services/${id}/start`, { method: 'POST' }),
  stop: (id: string) => request<ServiceCommandResult>(`/api/services/${id}/stop`, { method: 'POST' }),
  restart: (id: string) => request<ServiceCommandResult>(`/api/services/${id}/restart`, { method: 'POST' }),
};
