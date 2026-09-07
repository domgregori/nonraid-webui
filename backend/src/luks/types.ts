// Mirrors selectors/disks.ts's frontend DiskViewModel.encryption exactly, derived the same way
// (from NmdDisk.filesystem.type - "luks" is locked, "luks+*" is open, anything else is 'none') so
// backend and frontend never disagree about what a given disk's filesystem.type string means.
export type DiskEncryptionState = 'none' | 'luks-locked' | 'luks-open';

// Persisted array-wide preference (see settings/types.ts's LuksSettings) for how a LUKS data disk
// unlocks going forward: 'stored' means the shared keyfile is a valid key slot on every encrypted
// disk (nmdctl's own mount-time logic auto-opens with no prompt); 'manual' means it isn't, and a
// locked disk waits for an admin to supply a passphrase through the UI/CLI. Independent of the
// mandatory recovery-passphrase slot every encrypted disk also always carries - see
// docs/luks-support-scope.md's "Recovery" section.
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
  // Shown to the admin exactly once by the wizard, never persisted in plaintext anywhere after
  // this response - see recoveryPassphrase.ts's own doc comment.
  recoveryPassphrase: string;
}
