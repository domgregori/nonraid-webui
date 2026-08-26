import { createContext } from 'react';
import type { NmdStatusResponse, ParityCheckAction } from '../types/nmdApi';
import type { SmartSpinState } from '../types/smart';

/** 'not-configured' means a genuinely fresh install - nmdctl reports no array has ever been
 *  created yet. Distinct from 'error' (a real failure) so OnboardingGate can route into setup
 *  instead of the dashboard showing a scary error banner. */
export type LoadState = 'loading' | 'ready' | 'error' | 'not-configured';

export interface ArrayStatusContextValue {
  status: NmdStatusResponse | null;
  loadState: LoadState;
  /** Connectivity/poll error - cleared automatically the next time a poll succeeds. */
  error: string | null;
  /** Result of the last start/stop/parity action, e.g. a rejection like "can't stop while checking".
   *  Does NOT get cleared by background polling - only by the next action attempt - so it stays
   *  visible long enough to actually read. */
  actionError: string | null;
  /** True when the last stop attempt failed because something (usually Docker's own data root,
   *  relocated onto an array disk via Settings -> Docker & LXC Storage) still had a file open on
   *  an array disk - a real, expected failure mode, not a generic error. Lets the UI offer a
   *  targeted "stop Docker/LXC and retry" action instead of just showing the raw nmdctl error.
   *  Cleared by any other action, or once a stop attempt (with or without stopContainers) succeeds. */
  stopBlockedByContainers: boolean;
  temps: Record<string, number | null>;
  diskHealths: Record<string, 'passed' | 'failed' | null>;
  /** Spun up vs standby - polled at the same cadence as temps/diskHealths below. */
  spinStates: Record<string, SmartSpinState>;
  /** SSD/HDD per array disk device - fetched once (not polled), since a disk's rotational type
   *  never changes at runtime. */
  diskTypes: Record<string, boolean | null>;
  selectedDiskId: string | null;
  actionNote: string | null;
  arrayPending: boolean;
  parityPending: boolean;
  unassignPending: boolean;
  restorePending: boolean;
  /** Forces an immediate status re-fetch instead of waiting for the next poll tick (up to
   *  STATUS_POLL_MS stale), returning the freshly-fetched status directly (or null on failure) -
   *  for callers that need to read fresh data right after an action this context doesn't already
   *  know about (e.g. a config restore or array import completing), since every *other* action
   *  here already refreshes itself internally. Returns the value directly rather than relying on
   *  the caller re-reading `status` afterward: a plain function's own local variables (e.g.
   *  `hasAnyDisk` derived from `status` at render time) are fixed by closure and won't pick up a
   *  state update that happens later in the same call, even after awaiting one. */
  refresh: () => Promise<NmdStatusResponse | null>;
  /** stopContainers only takes effect when the array is currently started (i.e. this call is a
   *  stop, not a start) - see stopBlockedByContainers above for the retry flow that passes it. */
  toggleArray: (stopContainers?: boolean) => void;
  /** Dismisses the current actionError/stopBlockedByContainers without retrying - for closing
   *  ArrayStopBlockedModal's Cancel/overlay-click, which (unlike the inline banner it replaced)
   *  needs an explicit way to go away rather than just waiting for the next action attempt. */
  dismissActionError: () => void;
  parityAction: (action: ParityCheckAction) => void;
  selectDisk: (id: string) => void;
  closeDetail: () => void;
  /** Real - calls the backend, which writes directly to /proc/nmdcmd (see backend/README.md). */
  unassignDisk: (slot: number) => void;
  /** Undoes an *uncommitted* unassign (DISK_NP_MISSING, identity still intact) - only
   *  applies before the array has been started since. See ReplaceDiskDialog for the
   *  guided "swap in a different disk" flow, which is a separate, deliberately atomic
   *  backend call rather than a context action. */
  restoreDisk: (slot: number) => void;
}

export const ArrayStatusContext = createContext<ArrayStatusContextValue | null>(null);
