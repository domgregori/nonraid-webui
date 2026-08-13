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
  onSnapshots: () => void;
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

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/** lxc-info -i returns a flat mix of IPv4 and IPv6 addresses with no ordering guarantee - prefer
 *  showing IPv4 (shorter, more familiar for a LAN-facing container) and only fall back to IPv6 when
 *  a container genuinely has no IPv4 address at all, rather than cluttering the card with both. */
function preferIPv4(ips: string[]): string[] {
  const v4 = ips.filter((ip) => IPV4_RE.test(ip));
  return v4.length > 0 ? v4 : ips;
}

export function deriveLxcContainerViewModel(container: LxcContainerSummary, actions: LxcContainerActions): LxcContainerViewModel {
  const running = container.state === 'running';
  return {
    name: container.name,
    statusLabel: STATE_LABEL[container.state],
    statusColor: STATE_COLOR[container.state],
    autostart: container.autostart,
    description: container.description,
    webUiUrl: container.webUiUrl,
    cpuLabel: container.cpuPercent === null ? '-' : `${Math.round(container.cpuPercent)}%`,
    memLabel: container.memUsedBytes === null ? '-' : formatBytesAsMB(container.memUsedBytes),
    ips: container.ips.length > 0 ? preferIPv4(container.ips).join(', ') : '-',
    toggleLabel: running ? 'Stop' : 'Start',
    toggleBorder: running ? COLORS.red : COLORS.green,
    toggleBg: running ? 'transparent' : tint(COLORS.green, 15),
    toggleFg: running ? COLORS.red : COLORS.green,
    isPending: actions.isPending,
    onToggle: actions.onToggle,
    onRestart: actions.onRestart,
    onDestroy: actions.onDestroy,
    onEdit: actions.onEdit,
    onSnapshots: actions.onSnapshots,
  };
}
