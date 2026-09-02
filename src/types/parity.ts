export interface ParityViewModel {
  isRunning: boolean;
  /** True for the whole lifecycle of a new-disk clear (pending, active, or paused) - resync is a
   *  single shared status field, so a clear and a real parity check are otherwise indistinguishable
   *  from this view model alone. Callers use this to route the same progress/controls to the
   *  clearing disk's own card instead of the Parity Check card. */
  isClearing: boolean;
  /** True when a clear/recon is queued (pending, not active) but the driver's own recorded size
   *  for it is 0 - a stale-counter state, not a real operation with a real disk behind it (see
   *  realClient.ts's parityCheck doc comment). Start would just fail; only a driver reload fixes
   *  it, so the UI leads with that instead of a start button that's guaranteed to error. */
  needsDriverReload: boolean;
  /** True for a pending or active resync on a degraded array that isn't a new-disk clear - a real
   *  disk rebuild (e.g. after replacing a failed disk) reports its action as plain "check" at the
   *  driver level, indistinguishable string-wise from a routine scheduled check, even though
   *  nmdctl's own CLI already relabels this exact state "Data-Rebuild Disk N" using the array's
   *  degraded state as context. Callers use this to show "Rebuild" language instead of generic
   *  parity-check language - degraded is otherwise only used for the progress bar color. */
  isRebuild: boolean;
  canStart: boolean;
  barColor: string;
  progressPct: number;
  progressLabel: string;
  speedText: string;
  etaText: string;
  /** Same eta as etaText, worded for a small disk-card row ("35m remain") rather than the fuller
   *  Parity Check card ("35 min remaining") - see DataDiskCard's clearing view. */
  etaCompact: string;
  pauseLabel: string;
  startHandler: () => void;
  pauseHandler: () => void;
  cancelHandler: () => void;
}
