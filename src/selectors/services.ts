import { COLORS } from '../styles/colors';
import type { ServiceState } from '../types/servicesApi';

const STATE_LABEL: Record<ServiceState, string> = {
  active: 'Running',
  inactive: 'Stopped',
  failed: 'Failed',
  mixed: 'Partially running',
};

const STATE_COLOR: Record<ServiceState, string> = {
  active: COLORS.green,
  inactive: COLORS.textDim,
  failed: COLORS.red,
  mixed: COLORS.amber,
};

export function deriveServiceStatusView(state: ServiceState): { label: string; color: string } {
  return { label: STATE_LABEL[state], color: STATE_COLOR[state] };
}
