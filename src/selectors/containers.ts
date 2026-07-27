import { COLORS, tint } from '../styles/colors';
import type { Container, ContainerRuntimeStatus, ContainerViewModel } from '../types';

export function deriveContainerViewModel(container: Container, status: ContainerRuntimeStatus, onToggle: () => void): ContainerViewModel {
  const running = status === 'running';
  return {
    ...container,
    status,
    statusLabel: running ? 'Running' : 'Stopped',
    statusColor: running ? COLORS.green : COLORS.textDim,
    toggleLabel: running ? 'Stop' : 'Start',
    toggleBorder: running ? COLORS.red : COLORS.green,
    toggleBg: running ? 'transparent' : tint(COLORS.green, 15),
    toggleFg: running ? COLORS.red : COLORS.green,
    onToggle,
  };
}
