// Mirrors backend/src/luks/types.ts exactly - keep in sync.

export type DiskEncryptionState = 'none' | 'luks-locked' | 'luks-open';
export type LuksUnlockMode = 'stored' | 'manual';

export interface LuksDiskStatus {
  slot: number;
  encryption: DiskEncryptionState;
  device: string;
  mapName: string;
}

export interface LuksStatusResponse {
  unlockMode: LuksUnlockMode;
  keyfileExists: boolean;
  disks: LuksDiskStatus[];
}

export interface FormatAsLuksResult {
  slot: number;
  message: string;
  /** Shown to the admin exactly once - never fetchable again after this response. */
  recoveryPassphrase: string;
}
