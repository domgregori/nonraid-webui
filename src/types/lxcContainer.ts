export interface LxcContainerViewModel {
  name: string;
  statusLabel: string;
  statusColor: string;
  autostart: boolean;
  description: string | null;
  webUiUrl: string | null;
  distribution: string | null;
  cpuLabel: string;
  memLabel: string;
  ips: string;
  toggleLabel: string;
  toggleBorder: string;
  toggleBg: string;
  toggleFg: string;
  isPending: boolean;
  onToggle: () => void;
  onRestart: () => void;
  onDestroy: () => void;
  onEdit: () => void;
  onSnapshots: () => void;
  onToggleAutostart: () => void;
}
