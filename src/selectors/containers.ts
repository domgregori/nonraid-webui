import { COLORS, tint } from '../styles/colors';
import type { ContainerViewModel } from '../types';
import { CA_APP_NAME_LABEL, type DockerContainerSummary } from '../types/dockerApi';
import { formatBytesAsMB } from '../utils/format';

export interface ContainerActions {
  isPending: boolean;
  onToggle: () => void;
  onRestart: () => void;
  onEdit: () => void;
  onViewLogs: () => void;
  onDestroy: () => void;
}

/**
 * `ports` is a formatted display string like "8080:80, 9000/tcp" — entries
 * with a host:container pair are published (reachable from outside the
 * container), entries with just "port/proto" are container-internal only.
 * There's no per-app metadata saying which published port is "the" web UI
 * (that only exists for CA templates, and only during install), so this
 * picks the first published one as a best-effort guess — matches what most
 * container dashboards default to.
 */
function firstPublishedHostPort(ports: string): number | null {
  const first = ports.split(',')[0]?.trim();
  const match = first?.match(/^(\d+):\d+$/);
  return match ? Number(match[1]) : null;
}

/**
 * `webUiUrl`, when present, is the backend's real resolution of the CA
 * template's WebUI field against this container's actual ports — prefer it.
 * `[IP]` is left unresolved by the backend (it has no reliable way to know
 * which address the browser reaches it on), so fill it in here the same way
 * the Apps install dialog does.
 */
function resolveContainerWebUi(container: DockerContainerSummary): string | null {
  if (container.webUiUrl) return container.webUiUrl.replace('[IP]', window.location.hostname);
  const hostPort = firstPublishedHostPort(container.ports);
  return hostPort ? `http://${window.location.hostname}:${hostPort}` : null;
}

export function deriveContainerViewModel(container: DockerContainerSummary, actions: ContainerActions): ContainerViewModel {
  const running = container.state === 'running';
  return {
    id: container.id,
    name: container.name,
    image: container.image,
    ports: container.ports,
    statusLabel: running ? 'Running' : 'Stopped',
    statusColor: running ? COLORS.green : COLORS.textDim,
    cpuLabel: container.cpuPercent === null ? '—' : `${Math.round(container.cpuPercent)}%`,
    memLabel: container.memUsedBytes === null ? '—' : formatBytesAsMB(container.memUsedBytes),
    toggleLabel: running ? 'Stop' : 'Start',
    toggleBorder: running ? COLORS.red : COLORS.green,
    toggleBg: running ? 'transparent' : tint(COLORS.green, 15),
    toggleFg: running ? COLORS.red : COLORS.green,
    isPending: actions.isPending,
    caAppName: container.labels[CA_APP_NAME_LABEL] ?? null,
    webUiUrl: running ? resolveContainerWebUi(container) : null,
    onToggle: actions.onToggle,
    onRestart: actions.onRestart,
    onEdit: actions.onEdit,
    onViewLogs: actions.onViewLogs,
    onDestroy: actions.onDestroy,
  };
}
