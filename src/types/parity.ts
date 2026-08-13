export interface ParityViewModel {
  isRunning: boolean;
  /** True for the whole lifecycle of a new-disk clear (pending, active, or paused) — resync is a
   *  single shared status field, so a clear and a real parity check are otherwise indistinguishable
   *  from this view model alone. Callers use this to route the same progress/controls to the
   *  clearing disk's own card instead of the Parity Check card. */
  isClearing: boolean;
  /** True when a clear/recon is queued (pending, not active) but the driver's own recorded size
   *  for it is 0 — a stale-counter state, not a real operation with a real disk behind it (see
   *  realClient.ts's parityCheck doc comment). Start would just fail; only a driver reload fixes
   *  it, so the UI leads with that instead of a start button that's guaranteed to error. */
  needsDriverReload: boolean;
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
