export type ContainerRuntimeStatus = 'running' | 'stopped';

export interface Container {
  name: string;
  image: string;
  status: ContainerRuntimeStatus;
  cpu: string;
  mem: string;
  ports: string;
}

export interface ContainerViewModel extends Container {
  statusLabel: string;
  statusColor: string;
  toggleLabel: string;
  toggleBorder: string;
  toggleBg: string;
  toggleFg: string;
  onToggle: () => void;
}
