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
  caAppName: string | null; // set when installed via the Apps (Community Applications) catalog; null for a manually-added container
  onToggle: () => void;
  onRestart: () => void;
  onEdit: () => void;
}
