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

/** What luksApi.unlock() (and the hooks built on it) accept to unlock a disk - a typed passphrase,
 *  or an uploaded keyfile (a real browser File - its bytes are read and base64-encoded only at the
 *  point of sending each request, see luksApi.ts, never staged anywhere else first). Mirrors
 *  routes/luks.ts's own `{ passphrase? } | { keyfileBase64? }` request body, just typed as a real
 *  discriminated union client-side rather than two loose optional fields. */
export type UnlockSecret = { passphrase: string } | { keyfile: File };
