import type { NmdCommandResult, NmdStatusResponse, ParityCheckAction } from './types.js';

export interface NmdClient {
  readonly mode: 'real' | 'mock';
  getStatus(): Promise<NmdStatusResponse>;
  startArray(): Promise<NmdCommandResult>;
  stopArray(): Promise<NmdCommandResult>;
  parityCheck(action: ParityCheckAction): Promise<NmdCommandResult>;
  unassignDisk(slot: number): Promise<NmdCommandResult>;
  // The driver has no readback for write method — it's a write-only kernel
  // command (confirmed: absent from both `status -o json` and /proc/nmdstat)
  // — so the caller is the source of truth for what's "currently" set, same
  // as real Unraid's own webGUI does with its persisted disk.cfg tunable.
  setWriteMethod(turbo: boolean): Promise<NmdCommandResult>;
  // Unlike write method, the label *is* read back via getStatus().array.label
  // — nmdctl requires the array to be stopped to change it, and returns a
  // clear error otherwise; that error is surfaced as-is, not special-cased.
  setLabel(label: string): Promise<NmdCommandResult>;
}
