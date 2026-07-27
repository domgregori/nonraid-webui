import { BASE_LOG } from '../mock/activity';
import type { ActivityLogEntry } from '../types';

export function deriveActivityLog(): ActivityLogEntry[] {
  return BASE_LOG;
}
