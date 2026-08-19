export type ServiceState = 'active' | 'inactive' | 'failed' | 'mixed';

export interface ServiceStatus {
  id: string;
  label: string;
  state: ServiceState;
}

export interface ServiceCommandResult {
  ok: boolean;
  message: string;
}
