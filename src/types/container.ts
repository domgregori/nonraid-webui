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
  // A user-provided override (Settings' containerWebUiUrls), independent of webUiUrl above - set
  // regardless of whether the container is currently running, since it's just a settings value;
  // webUiUrl itself is null while stopped even when this is set (there's nothing live to open).
  customWebUiUrl: string | null;
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
