/**
 * Demo-only array-state preview, not backed by a real array.
 * Remove this concept entirely once the app is wired to a real nmdctl backend —
 * arrayStarted/parity/disks should then derive from real status, not a scenario string.
 */
export type Scenario = 'healthy' | 'degraded' | 'paritycheck';
