import { COLORS, tint } from '../styles/colors';
import type { ContainerViewModel } from '../types';
import { CA_APP_NAME_LABEL, type DockerContainerSummary } from '../types/dockerApi';
import { formatBytesAsMB } from '../utils/format';

export interface ContainerActions {
  isPending: boolean;
  onToggle: () => void;
  onRestart: () => void;
  onEdit: () => void;
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
    onToggle: actions.onToggle,
    onRestart: actions.onRestart,
    onEdit: actions.onEdit,
  };
}
