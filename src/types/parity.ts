export interface ParityViewModel {
  isRunning: boolean;
  /** True for the whole lifecycle of a new-disk clear (pending, active, or paused) — resync is a
   *  single shared status field, so a clear and a real parity check are otherwise indistinguishable
   *  from this view model alone. Callers use this to route the same progress/controls to the
   *  clearing disk's own card instead of the Parity Check card. */
  isClearing: boolean;
  canStart: boolean;
  barColor: string;
  progressPct: number;
  progressLabel: string;
  speedText: string;
  etaText: string;
  /** Same eta as etaText, worded for a small disk-card row ("35m remain") rather than the fuller
   *  Parity Check card ("35 min remaining") — see DataDiskCard's clearing view. */
  etaCompact: string;
  pauseLabel: string;
  startHandler: () => void;
  pauseHandler: () => void;
  cancelHandler: () => void;
}
