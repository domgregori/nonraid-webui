export interface ContainerViewModel {
  id: string;
  name: string;
  icon: string | null;
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
  webUiUrl: string | null; // best-effort link built from the first published host port; null when nothing is published
  autostart: boolean;
  // null = not yet checked (or the last check failed) - see docker/updateCheck.ts on the backend.
  updateAvailable: boolean | null;
  onToggle: () => void;
  onRestart: () => void;
  onEdit: () => void;
  onViewLogs: () => void;
  onDestroy: () => void;
  onToggleAutostart: () => void;
  onUpdateNow: () => void;
}
