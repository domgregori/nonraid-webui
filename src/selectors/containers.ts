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

export function deriveContainerViewModel(container: DockerContainerSummary, actions: ContainerActions): ContainerViewModel {
  const running = container.state === 'running';
  const hostPort = running ? firstPublishedHostPort(container.ports) : null;
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
    webUiUrl: hostPort ? `http://${window.location.hostname}:${hostPort}` : null,
    onToggle: actions.onToggle,
    onRestart: actions.onRestart,
    onEdit: actions.onEdit,
    onViewLogs: actions.onViewLogs,
  };
}
