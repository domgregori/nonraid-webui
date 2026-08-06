import { createContext } from 'react';
import type { NmdStatusResponse, ParityCheckAction } from '../types/nmdApi';

export type LoadState = 'loading' | 'ready' | 'error';

export interface ArrayStatusContextValue {
  status: NmdStatusResponse | null;
  loadState: LoadState;
  /** Connectivity/poll error — cleared automatically the next time a poll succeeds. */
  error: string | null;
  /** Result of the last start/stop/parity action, e.g. a rejection like "can't stop while checking".
   *  Does NOT get cleared by background polling — only by the next action attempt — so it stays
   *  visible long enough to actually read. */
  actionError: string | null;
  temps: Record<string, number | null>;
  selectedDiskId: string | null;
  actionNote: string | null;
  arrayPending: boolean;
  parityPending: boolean;
  unassignPending: boolean;
  restorePending: boolean;
  toggleArray: () => void;
  parityAction: (action: ParityCheckAction) => void;
  selectDisk: (id: string) => void;
  closeDetail: () => void;
  /** Real — calls the backend, which writes directly to /proc/nmdcmd (see backend/README.md). */
  unassignDisk: (slot: number) => void;
  /** Undoes an *uncommitted* unassign (DISK_NP_MISSING, identity still intact) — only
   *  applies before the array has been started since. See ReplaceDiskDialog for the
   *  guided "swap in a different disk" flow, which is a separate, deliberately atomic
   *  backend call rather than a context action. */
  restoreDisk: (slot: number) => void;
}

export const ArrayStatusContext = createContext<ArrayStatusContextValue | null>(null);
