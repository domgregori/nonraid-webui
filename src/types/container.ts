export interface ContainerViewModel {
  id: string;
  name: string;
  image: string;
  ports: string;
  statusLabel: string;
  statusColor: string;
  cpuLabel: string;
  memLabel: string;
  toggleLabel: string;
  toggleBorder: string;
  toggleBg: string;
  toggleFg: string;
  isPending: boolean;
  onToggle: () => void;
  onRestart: () => void;
}
