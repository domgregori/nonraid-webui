import { COLORS, tint } from '../styles/colors';
import type { LxcContainerSummary } from '../types/lxcApi';
import type { LxcContainerViewModel } from '../types/lxcContainer';
import { formatBytesAsMB } from '../utils/format';

export interface LxcContainerActions {
  isPending: boolean;
  onToggle: () => void;
  onRestart: () => void;
  onDestroy: () => void;
  onEdit: () => void;
}

const STATE_LABEL: Record<LxcContainerSummary['state'], string> = {
  running: 'Running',
  stopped: 'Stopped',
  frozen: 'Frozen',
  unknown: 'Unknown',
};

const STATE_COLOR: Record<LxcContainerSummary['state'], string> = {
  running: COLORS.green,
  stopped: COLORS.textDim,
  frozen: COLORS.blue,
  unknown: COLORS.amber,
};

export function deriveLxcContainerViewModel(container: LxcContainerSummary, actions: LxcContainerActions): LxcContainerViewModel {
  const running = container.state === 'running';
  return {
    name: container.name,
    statusLabel: STATE_LABEL[container.state],
    statusColor: STATE_COLOR[container.state],
    autostart: container.autostart,
    description: container.description,
    webUiUrl: container.webUiUrl,
    cpuLabel: container.cpuPercent === null ? '—' : `${Math.round(container.cpuPercent)}%`,
    memLabel: container.memUsedBytes === null ? '—' : formatBytesAsMB(container.memUsedBytes),
    ips: container.ips.length > 0 ? container.ips.join(', ') : '—',
    toggleLabel: running ? 'Stop' : 'Start',
    toggleBorder: running ? COLORS.red : COLORS.green,
    toggleBg: running ? 'transparent' : tint(COLORS.green, 15),
    toggleFg: running ? COLORS.red : COLORS.green,
    isPending: actions.isPending,
    onToggle: actions.onToggle,
    onRestart: actions.onRestart,
    onDestroy: actions.onDestroy,
    onEdit: actions.onEdit,
  };
}
