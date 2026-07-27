import type { NmdCommandResult, NmdStatusResponse, ParityCheckAction } from './types.js';

export interface NmdClient {
  readonly mode: 'real' | 'mock';
  getStatus(): Promise<NmdStatusResponse>;
  startArray(): Promise<NmdCommandResult>;
  stopArray(): Promise<NmdCommandResult>;
  parityCheck(action: ParityCheckAction): Promise<NmdCommandResult>;
  unassignDisk(slot: number): Promise<NmdCommandResult>;
}
